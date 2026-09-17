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

test('a forced strikes exit writes off the position instead of producing NaN', () => {
  const missing = { ts: 0, missingPrice: true }; // no priceUsd key at all
  const ticks = [
    tick(0, 1),
    { ...missing, ts: 15_000 },
    { ...missing, ts: 30_000 },
    { ...missing, ts: 45_000 },
    { ...missing, ts: 60_000 },
    { ...missing, ts: 75_000 }, // 5th consecutive miss forces the exit
  ];
  const result = replayPathFromEntry(ticks, 0, DEFAULT_RULES);
  assert.equal(result.exitReason, 'strikes');
  assert.equal(Number.isNaN(result.returnMultiple), false);
  assert.equal(result.returnMultiple, 0); // total write-off, not a real sale price
});

test('replayAll never returns NaN even when one path had a forced write-off', () => {
  const missing = { ts: 0, missingPrice: true };
  const strikesPath = { ticks: [tick(0, 1), { ...missing, ts: 15_000 }, { ...missing, ts: 30_000 }, { ...missing, ts: 45_000 }, { ...missing, ts: 60_000 }, { ...missing, ts: 75_000 }] };
  const normalPath = { ticks: [tick(0, 1), tick(15_000, 1.1)] };
  const summary = replayAll([strikesPath, normalPath], DEFAULT_RULES);
  assert.equal(Number.isNaN(summary.avgReturnPct), false);
});

test('replayAll averages return pct across many recorded paths', () => {
  const winPath = { ticks: [tick(0, 1), tick(15_000, 2.5, { buySell5m: 1, m5Pct: 1, volume5mUsd: 1 })] };
  const losePath = { ticks: [tick(0, 1), tick(15_000, 0.74)] };
  const summary = replayAll([winPath, losePath], DEFAULT_RULES);
  assert.equal(summary.count, 2);
  assert.ok(summary.avgReturnPct > -50 && summary.avgReturnPct < 100);
});
