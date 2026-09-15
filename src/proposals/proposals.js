import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readJson, writeJson } from '../utils/store.js';
import { LOCKED_RULE_KEYS, ROOT_DIR } from '../config.js';

function rulesOverrideFile(dataDir) {
  return path.join(dataDir, 'rules.json');
}

function proposalsFile(dataDir) {
  return path.join(dataDir, 'proposals.json');
}

function getPath(obj, dottedKey) {
  return dottedKey.split('.').reduce((o, k) => o?.[k], obj);
}

function setPath(obj, dottedKey, value) {
  const keys = dottedKey.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    cur[keys[i]] = cur[keys[i]] ?? {};
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
}

export function isLockedKey(dottedKey) {
  return LOCKED_RULE_KEYS.has(dottedKey.split('.')[0]);
}

export function loadRulesOverride(dataDir) {
  return readJson(rulesOverrideFile(dataDir), {});
}

export function saveRulesOverride(dataDir, override) {
  writeJson(rulesOverrideFile(dataDir), override);
}

// Deep-merges the persisted override on top of the config's baseline rules.
// Call this once after loadConfig() so an approved proposal takes effect on
// the next restart (and can be applied live by the caller re-merging).
export function effectiveRules(config) {
  const override = loadRulesOverride(config.dataDir);
  const merged = JSON.parse(JSON.stringify(config.rules));
  for (const key of Object.keys(override)) {
    setPath(merged, key, override[key]);
  }
  return merged;
}

export function loadProposals(dataDir) {
  return readJson(proposalsFile(dataDir), []);
}

function saveProposals(dataDir, proposals) {
  writeJson(proposalsFile(dataDir), proposals);
}

// changes: { "stopLossPct": 0.3, "filters.liquidityMinUsd": 20000, ... }
export function createProposal(config, title, evidence, changes) {
  for (const key of Object.keys(changes)) {
    if (isLockedKey(key)) {
      throw new Error(`"${key}" is a locked risk key and can never be proposed`);
    }
  }

  const current = effectiveRules(config);
  const proposals = loadProposals(config.dataDir);
  const proposal = {
    id: (proposals.at(-1)?.id ?? 0) + 1,
    title,
    evidence,
    changes: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, { old: getPath(current, k), new: v }])),
    status: 'pending',
    createdAt: Date.now(),
    decidedAt: null,
  };
  proposals.push(proposal);
  saveProposals(config.dataDir, proposals);
  return proposal;
}

export function rejectProposal(config, id) {
  const proposals = loadProposals(config.dataDir);
  const proposal = proposals.find((p) => p.id === id);
  if (!proposal) throw new Error(`no proposal #${id}`);
  proposal.status = 'rejected';
  proposal.decidedAt = Date.now();
  saveProposals(config.dataDir, proposals);
  return proposal;
}

// Applies the proposal's changes, runs the test suite, and reverts on failure.
export function approveProposal(config, id, { runTests = defaultRunTests } = {}) {
  const proposals = loadProposals(config.dataDir);
  const proposal = proposals.find((p) => p.id === id);
  if (!proposal) throw new Error(`no proposal #${id}`);
  if (proposal.status !== 'pending') throw new Error(`proposal #${id} is already ${proposal.status}`);

  const before = loadRulesOverride(config.dataDir);
  const after = JSON.parse(JSON.stringify(before));
  for (const [key, { new: newValue }] of Object.entries(proposal.changes)) {
    setPath(after, key, newValue);
  }
  saveRulesOverride(config.dataDir, after);

  const testResult = runTests();
  if (!testResult.passed) {
    saveRulesOverride(config.dataDir, before); // revert
    proposal.status = 'rejected';
    proposal.decidedAt = Date.now();
    proposal.rejectReason = 'test suite failed after applying; reverted';
    saveProposals(config.dataDir, proposals);
    return { proposal, applied: false, testOutput: testResult.output };
  }

  proposal.status = 'applied';
  proposal.decidedAt = Date.now();
  saveProposals(config.dataDir, proposals);
  return { proposal, applied: true, testOutput: testResult.output };
}

function defaultRunTests() {
  const result = spawnSync('npm', ['test'], { cwd: ROOT_DIR, encoding: 'utf8' });
  return { passed: result.status === 0, output: `${result.stdout || ''}${result.stderr || ''}` };
}
