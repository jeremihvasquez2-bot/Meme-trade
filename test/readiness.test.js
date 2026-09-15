import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkReadiness } from '../src/money/readiness.js';

function baseSummary(overrides = {}) {
  return { closedCount: 30, spanDays: 14, net: 10, profitableWeeks: 2, ...overrides };
}
function baseState(overrides = {}) {
  return { halted: false, rounds: { won: 3, lost: 1 }, ...overrides };
}
function baseReplay(overrides = {}) {
  return { count: 40, avgReturnPct: 8, ...overrides };
}

test('go is true only when every gate clears', () => {
  const { go, unmet } = checkReadiness({ summary: baseSummary(), state: baseState(), replaySummary: baseReplay() });
  assert.equal(go, true);
  assert.deepEqual(unmet, []);
});

test('blocks on too few closed trades', () => {
  const { go, unmet } = checkReadiness({ summary: baseSummary({ closedCount: 10 }), state: baseState(), replaySummary: baseReplay() });
  assert.equal(go, false);
  assert.ok(unmet.some((u) => u.includes('closed trades')));
});

test('blocks when rounds lost meets or exceeds rounds won', () => {
  const { go, unmet } = checkReadiness({ summary: baseSummary(), state: baseState({ rounds: { won: 3, lost: 3 } }), replaySummary: baseReplay() });
  assert.equal(go, false);
  assert.ok(unmet.some((u) => u.includes('rounds won')));
});

test('blocks while halted regardless of other gates', () => {
  const { go, unmet } = checkReadiness({ summary: baseSummary(), state: baseState({ halted: true }), replaySummary: baseReplay() });
  assert.equal(go, false);
  assert.ok(unmet.some((u) => u.includes('halted')));
});

test('blocks on weak replay performance even with enough paths', () => {
  const { go, unmet } = checkReadiness({ summary: baseSummary(), state: baseState(), replaySummary: baseReplay({ avgReturnPct: 2 }) });
  assert.equal(go, false);
  assert.ok(unmet.some((u) => u.includes('replay avg return')));
});
