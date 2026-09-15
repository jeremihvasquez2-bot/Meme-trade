import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProposal, approveProposal, rejectProposal, effectiveRules, loadRulesOverride } from '../src/proposals/proposals.js';
import { tmpConfig } from './helpers.js';

test('locked risk keys can never be proposed', () => {
  const config = tmpConfig();
  assert.throws(() => createProposal(config, 'raise size', 'yolo', { positionSizePct: 0.5 }), /locked/);
  assert.throws(() => createProposal(config, 'raise cap', 'yolo', { dailyCapPct: 0.9 }), /locked/);
});

test('a proposal applies and takes effect once approved and tests pass', () => {
  const config = tmpConfig();
  const proposal = createProposal(config, 'wider trailing stop', 'replay showed +3%/trade', { trailingStopPct: 0.35 });
  assert.equal(proposal.status, 'pending');
  assert.equal(proposal.changes.trailingStopPct.old, config.rules.trailingStopPct);

  const { applied } = approveProposal(config, proposal.id, { runTests: () => ({ passed: true, output: 'ok' }) });
  assert.equal(applied, true);
  assert.equal(effectiveRules(config).trailingStopPct, 0.35);
});

test('a proposal reverts and is rejected if the test suite fails after applying it', () => {
  const config = tmpConfig();
  const before = loadRulesOverride(config.dataDir);
  const proposal = createProposal(config, 'bad change', 'guess', { takeProfitMultiple: 3 });

  const { applied } = approveProposal(config, proposal.id, { runTests: () => ({ passed: false, output: 'FAIL' }) });
  assert.equal(applied, false);
  assert.deepEqual(loadRulesOverride(config.dataDir), before); // reverted
  assert.equal(effectiveRules(config).takeProfitMultiple, config.rules.takeProfitMultiple);
});

test('a nested filter key can be proposed and applied via dotted path', () => {
  const config = tmpConfig();
  const proposal = createProposal(config, 'loosen liquidity floor', 'too many misses near 15k', { 'filters.liquidityMinUsd': 10_000 });
  approveProposal(config, proposal.id, { runTests: () => ({ passed: true, output: 'ok' }) });
  assert.equal(effectiveRules(config).filters.liquidityMinUsd, 10_000);
});

test('rejecting a proposal leaves the rules untouched', () => {
  const config = tmpConfig();
  const proposal = createProposal(config, 'try something', 'hunch', { cooldownAfterLossMs: 1000 });
  rejectProposal(config, proposal.id);
  assert.equal(effectiveRules(config).cooldownAfterLossMs, config.rules.cooldownAfterLossMs);
});
