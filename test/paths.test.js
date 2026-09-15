import test from 'node:test';
import assert from 'node:assert/strict';
import './helper.js';
import { freshData, cleanup } from './helper.js';
import { startPath, recordTick, closePath, loadPaths, openPaths, expirePaths, pathStats, countPaths, readTicks } from '../src/paths.js';
import { HOUR } from '../src/util.js';

test.beforeEach(() => freshData());
test.after(cleanup);

const start = (kind = 'shadow') =>
  startPath({ mint: 'M1', symbol: 'AAA', kind, entryPriceUsd: 1, features: { liquidityUsd: 50_000 }, score: 70 });

test('a path records the features it had at entry', () => {
  const meta = start();
  assert.equal(meta.kind, 'shadow');
  assert.equal(meta.features.liquidityUsd, 50_000);
  assert.equal(meta.entryPriceUsd, 1);
  assert.equal(meta.closed, false);
});

test('ticks are appended one per call', () => {
  const meta = start();
  recordTick(meta.id, { priceUsd: 1.1, m5: 3, buysM5: 20, sellsM5: 10, volumeM5: 4000 });
  recordTick(meta.id, { priceUsd: 1.3 });
  const ticks = readTicks(meta.id);
  assert.equal(ticks.length, 2);
  assert.equal(ticks[0].price, 1.1);
  assert.equal(ticks[0].buys, 20);
  assert.equal(ticks[1].price, 1.3);
});

test('a missing price is recorded as a zero, not skipped', () => {
  const meta = start();
  recordTick(meta.id, { priceUsd: 0 });
  assert.equal(readTicks(meta.id)[0].price, 0);
});

test('a closed path stops accepting ticks', () => {
  const meta = start();
  closePath(meta.id, 'WIN');
  assert.equal(recordTick(meta.id, { priceUsd: 2 }), null);
  assert.equal(readTicks(meta.id).length, 0);
});

test('shadow paths expire after their window', () => {
  const meta = start();
  assert.equal(openPaths().length, 1);
  assert.equal(expirePaths(Date.now() + 7 * HOUR), 1);
  assert.equal(openPaths(Date.now() + 7 * HOUR).length, 0);
});

test('loadPaths skips paths too short to learn anything from', () => {
  const a = start();
  recordTick(a.id, { priceUsd: 1 });
  const b = start();
  recordTick(b.id, { priceUsd: 1 });
  recordTick(b.id, { priceUsd: 1.2 });
  assert.equal(loadPaths({ minTicks: 2 }).length, 1);
  assert.equal(countPaths(), 2);
});

test('loadPaths can be filtered to real positions only', () => {
  const traded = start('position');
  recordTick(traded.id, { priceUsd: 1 });
  recordTick(traded.id, { priceUsd: 2 });
  const shadow = start('shadow');
  recordTick(shadow.id, { priceUsd: 1 });
  recordTick(shadow.id, { priceUsd: 2 });
  assert.equal(loadPaths({ kind: 'position' }).length, 1);
});

test('path stats describe the shape of what happened', () => {
  const meta = start();
  for (const price of [1, 1.8, 0.6, 1.2]) recordTick(meta.id, { priceUsd: price });
  const stats = pathStats(loadPaths()[0]);
  assert.equal(stats.peakMultiple, 1.8);
  assert.equal(stats.drawdown, -40);
  assert.equal(stats.endPct, 20);
});
