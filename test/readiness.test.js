import test from 'node:test';
import assert from 'node:assert/strict';
import './helper.js';
import { freshData, cleanup, ticks } from './helper.js';
import { checks, render } from '../src/readiness.js';
import { freshState } from '../src/state.js';
import { startPath, recordTick } from '../src/paths.js';
import { DAY } from '../src/util.js';

test.beforeEach(() => freshData());
test.after(cleanup);

const trade = (i, pnl) => ({
  mint: `M${i}`, symbol: `T${i}`, pnlUsd: pnl, feesUsd: 0.4,
  openedAt: Date.now() - 20 * DAY, closedAt: Date.now() - (20 - i * 0.5) * DAY,
  outcome: pnl >= 0 ? 'WIN' : 'LOSE', reason: 'take_profit', peakMultiple: 2, features: {},
});

function readyState() {
  const state = freshState(Date.now() - 20 * DAY);
  state.firstTradeAt = Date.now() - 20 * DAY;
  state.roundsWon = 3;
  state.roundsLost = 1;
  state.weeks = { '2026-W01': 12, '2026-W02': 9, '2026-W03': -2 };
  return state;
}

/** 45 recorded paths that each double — enough to clear the replay bar. */
function recordWinningPaths(n = 45) {
  for (let i = 0; i < n; i++) {
    const meta = startPath({ mint: `M${i}`, symbol: `T${i}`, kind: 'shadow', entryPriceUsd: 1, features: {}, score: 70 });
    for (const tick of ticks([1, 1.5, 2.2, 2.8])) recordTick(meta.id, { priceUsd: tick.price });
  }
}

test('a brand new bot is not ready and says exactly why', () => {
  const result = checks(freshState());
  assert.equal(result.go, false);
  const failing = result.rows.filter((r) => !r.ok).map((r) => r.label);
  assert.ok(failing.includes('Closed trades'));
  assert.ok(failing.includes('Days running'));
  assert.ok(failing.includes('Recorded price paths'));
});

test('every gate met means GO', () => {
  recordWinningPaths();
  const trades = Array.from({ length: 30 }, (_, i) => trade(i, i % 3 === 0 ? -2 : 2));
  const result = checks(readyState(), { trades });
  assert.equal(result.go, true, result.rows.filter((r) => !r.ok).map((r) => r.label).join(', '));
  assert.match(render(result), /READINESS: GO/);
});

test('being halted blocks the gate no matter how good the numbers are', () => {
  recordWinningPaths();
  const state = readyState();
  state.halted = true;
  state.haltedReason = 'kill switch';
  const trades = Array.from({ length: 30 }, (_, i) => trade(i, 2));
  const result = checks(state, { trades });
  assert.equal(result.go, false);
  assert.ok(result.rows.find((r) => r.label === 'Not halted' && !r.ok));
});

test('losing more rounds than it wins blocks the gate', () => {
  recordWinningPaths();
  const state = readyState();
  state.roundsWon = 3;
  state.roundsLost = 5;
  const result = checks(state, { trades: Array.from({ length: 30 }, (_, i) => trade(i, 2)) });
  assert.equal(result.go, false);
  assert.ok(result.rows.find((r) => r.label === 'More rounds won than lost' && !r.ok));
});

test('too few recorded paths blocks the replay check even if the paths look good', () => {
  recordWinningPaths(10);
  const result = checks(readyState(), { trades: Array.from({ length: 30 }, (_, i) => trade(i, 2)) });
  const replayRow = result.rows.find((r) => r.label === 'Replay of current rules');
  assert.equal(replayRow.ok, false);
});

test('the monthly profit target is reported as a line, not a gate', () => {
  const result = checks(freshState());
  assert.ok(!result.rows.some((r) => /monthly/i.test(r.label)));
  assert.match(render(result), /a line, not a gate/);
});
