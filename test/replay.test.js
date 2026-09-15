import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replayPathFromEntry, replayAll } from '../src/learning/replay.js';
import { DEFAULT_RULES } from '../src/config.js';

function tick(t, priceUsd, extra = {}) {
  return { ts: t, priceUsd, ...extra };
}

test('replay hits take profit on a path that runs to 2.5x', () => {
  const ticks = [
    tick(0, 1),
    tick(15_000, 1.5),
    tick(30_000, 2.0),
    tick(45_000, 2.5, { buySell5m: 1, m5Pct: 1, volume5mUsd: 100 }),
  ];
  const result = replayPathFromEntry(ticks, 0, DEFAULT_RULES);
  assert.equal(result.exitReason, 'take_profit');
  assert.equal(result.returnMultiple, 2.5);
});

test('replay hits stop loss on a path that dumps', () => {
  const ticks = [tick(0, 1), tick(15_000, 0.9), tick(30_000, 0.74)];
  const result = replayPathFromEntry(ticks, 0, DEFAULT_RULES);
  assert.equal(result.exitReason, 'stop_loss');
  assert.ok(result.returnMultiple < 1);
});

test('replay marks-to-last-price when the path ends before any exit fires', () => {
  const ticks = [tick(0, 1), tick(15_000, 1.05), tick(30_000, 1.1)];
  const result = replayPathFromEntry(ticks, 0, DEFAULT_RULES);
  assert.equal(result.exitReason, 'path_ended');
  assert.equal(result.returnMultiple, 1.1);
});

test('replayAll averages return pct across many recorded paths', () => {
  const winPath = { ticks: [tick(0, 1), tick(15_000, 2.5, { buySell5m: 1, m5Pct: 1, volume5mUsd: 1 })] };
  const losePath = { ticks: [tick(0, 1), tick(15_000, 0.74)] };
  const summary = replayAll([winPath, losePath], DEFAULT_RULES);
  assert.equal(summary.count, 2);
  assert.ok(summary.avgReturnPct > -50 && summary.avgReturnPct < 100);
});
