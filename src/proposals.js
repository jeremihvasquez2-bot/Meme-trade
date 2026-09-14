// Proposals: the only way the bot's rules change, and they never change
// without you. Risk limits, position size and the kill switch are not
// proposable at all — not "discouraged", refused.
import { spawnSync } from 'node:child_process';
import { cfg, isLocked, reload, LOCKED_KEYS } from './config.js';
import { dataPath, readJson, writeJson } from './store.js';
import { log } from './log.js';
import { num } from './util.js';

export function proposalsFile() {
  return dataPath('proposals.json');
}
export function historyFile() {
  return dataPath('tune-history.json');
}

export function loadProposals() {
  const list = readJson(proposalsFile(), []);
  return Array.isArray(list) ? list : [];
}

export function saveProposals(list) {
  writeJson(proposalsFile(), list);
  return list;
}

export function loadTune() {
  return readJson(cfg.TUNE_FILE, {}) || {};
}

export function loadHistory() {
  const list = readJson(historyFile(), []);
  return Array.isArray(list) ? list : [];
}

function coerceValue(key, value) {
  const d = cfg.DEFAULTS[key];
  if (typeof d === 'number') {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new Error(`${key} must be a number`);
    return n;
  }
  if (typeof d === 'boolean') return /^(1|true|yes|on)$/i.test(String(value));
  return String(value);
}

/** Record a proposed config change. Nothing is applied here. */
export function propose({ title, evidence, changes }) {
  const entries = Object.entries(changes || {});
  if (!entries.length) throw new Error('a proposal must change at least one key');
  const refused = entries.filter(([key]) => isLocked(key)).map(([key]) => key);
  if (refused.length) {
    throw new Error(
      `refused: ${refused.join(', ')} ${refused.length === 1 ? 'is' : 'are'} locked. ` +
        `Risk limits, position size and the kill switch can only be changed by editing .env yourself.`,
    );
  }

  const list = loadProposals();
  const proposal = {
    n: (list.at(-1)?.n || 0) + 1,
    title: String(title || '').trim(),
    evidence: String(evidence || '').trim(),
    changes: Object.fromEntries(entries.map(([key, to]) => [key, { from: cfg[key], to: coerceValue(key, to) }])),
    status: 'pending',
    createdAt: Date.now(),
  };
  if (!proposal.title) throw new Error('a proposal needs a title');
  list.push(proposal);
  saveProposals(list);
  return proposal;
}

export function pending() {
  return loadProposals().filter((p) => p.status === 'pending');
}

export function find(n) {
  return loadProposals().find((p) => p.n === num(n)) || null;
}

function defaultRunTests() {
  const res = spawnSync('npm', ['test'], { cwd: cfg.ROOT, encoding: 'utf8', timeout: 300000, shell: process.platform === 'win32' });
  return { ok: res.status === 0, output: `${res.stdout || ''}${res.stderr || ''}`.slice(-4000) };
}

/**
 * Apply a proposal, then prove the bot still works. A failing test suite
 * reverts the change — no exceptions, no "probably unrelated".
 */
export function approve(n, { runTests = defaultRunTests } = {}) {
  const list = loadProposals();
  const proposal = list.find((p) => p.n === num(n));
  if (!proposal) throw new Error(`no proposal ${n}`);
  if (proposal.status !== 'pending') throw new Error(`proposal ${n} is already ${proposal.status}`);

  const locked = Object.keys(proposal.changes).filter((key) => isLocked(key));
  if (locked.length) {
    proposal.status = 'rejected';
    proposal.note = `locked keys: ${locked.join(', ')}`;
    proposal.decidedAt = Date.now();
    saveProposals(list);
    throw new Error(`refused: ${locked.join(', ')} ${locked.length === 1 ? 'is' : 'are'} locked`);
  }

  const before = loadTune();
  const after = { ...before };
  for (const [key, change] of Object.entries(proposal.changes)) after[key] = change.to;
  writeJson(cfg.TUNE_FILE, after);
  reload();

  const result = runTests();
  if (!result.ok) {
    writeJson(cfg.TUNE_FILE, before);
    reload();
    proposal.status = 'failed';
    proposal.note = 'tests failed after applying — reverted';
    proposal.decidedAt = Date.now();
    proposal.testOutput = result.output;
    saveProposals(list);
    log.warn(`proposal ${n} reverted: tests failed`);
    return { ok: false, proposal, output: result.output };
  }

  proposal.status = 'approved';
  proposal.decidedAt = Date.now();
  saveProposals(list);
  const history = loadHistory();
  history.push({
    at: Date.now(),
    n: proposal.n,
    title: proposal.title,
    changes: proposal.changes,
    evidence: proposal.evidence,
  });
  writeJson(historyFile(), history);
  log.info(`proposal ${n} applied: ${proposal.title}`);
  return { ok: true, proposal };
}

export function reject(n, note = 'rejected by owner') {
  const list = loadProposals();
  const proposal = list.find((p) => p.n === num(n));
  if (!proposal) throw new Error(`no proposal ${n}`);
  if (proposal.status !== 'pending') throw new Error(`proposal ${n} is already ${proposal.status}`);
  proposal.status = 'rejected';
  proposal.note = note;
  proposal.decidedAt = Date.now();
  saveProposals(list);
  return proposal;
}

export function describe(proposal) {
  const changes = Object.entries(proposal.changes)
    .map(([key, c]) => `    ${key}: ${c.from} → ${c.to}`)
    .join('\n');
  return `#${proposal.n} ${proposal.title} [${proposal.status}]\n${changes}\n    why: ${proposal.evidence || '(no evidence given)'}`;
}

export const LOCKED = [...LOCKED_KEYS];
