import test from 'node:test';
import assert from 'node:assert/strict';
import './helper.js';
import { freshData, cleanup, ticks } from './helper.js';
import { cfg } from '../src/config.js';
import { replayPath, summarise, gridSearch, measureRoundTripCost, DEFAULT_ROUND_TRIP_COST_PCT } from '../src/replay.js';

test.beforeEach(() => freshData());
test.after(cleanup);

const path = (prices, over = {}) => ({ mint: 'M', symbol: 'T', kind: 'shadow', score: 70, features: {}, entryPriceUsd: prices[0], ticks: ticks(prices), ...over });

test('a path that doubles and a half is taken at the target', () => {
  const result = replayPath(path([1, 1.4, 1.9, 2.6, 3.5]), cfg, 0);
  assert.equal(result.reason, 'take_profit');
  assert.ok(Math.abs(result.grossPct - 160) < 1, `got ${result.grossPct}`);
});

test('a path that falls is cut at the stop loss', () => {
  const result = replayPath(path([1, 0.9, 0.8, 0.7, 0.2]), cfg, 0);
  assert.equal(result.reason, 'stop_loss');
  assert.ok(result.returnPct < -20 && result.returnPct > -35);
});

test('a path that runs then rolls over exits on the trail', () => {
  const result = replayPath(path([1, 1.5, 2.0, 1.3]), cfg, 0);
  assert.equal(result.reason, 'trailing_stop');
});

test('the round-trip cost is taken off every replayed trade', () => {
  const free = replayPath(path([1, 1.4, 1.9, 2.6]), cfg, 0);
  const costly = replayPath(path([1, 1.4, 1.9, 2.6]), cfg, 10);
  assert.ok(costly.returnPct < free.returnPct - 20);
});

test('a path with almost no ticks is not replayed at all', () => {
  assert.equal(replayPath({ ...path([1]), ticks: ticks([1]) }, cfg, 0), null);
});

test('summarise reports the shape of a set of results', () => {
  const stats = summarise([{ returnPct: 100, reason: 'take_profit' }, { returnPct: -25, reason: 'stop_loss' }, { returnPct: -25, reason: 'stop_loss' }]);
  assert.equal(stats.trades, 3);
  assert.equal(stats.winRate, 33.3);
  assert.equal(stats.avgPct, 16.67);
  assert.equal(stats.byReason.stop_loss.n, 2);
  assert.equal(stats.best, 100);
});

test('summarise copes with nothing at all', () => {
  assert.equal(summarise([]).trades, 0);
});

test('the grid search ranks rule sets and keeps their rules', () => {
  const paths = [path([1, 1.3, 1.8, 2.2, 2.0, 1.4]), path([1, 0.9, 0.8, 0.6])];
  const rows = gridSearch({ paths, costPct: 0, grid: { TAKE_PROFIT_X: [1.8, 3.0], STOP_LOSS_PCT: [0.25] } });
  assert.equal(rows.length, 2);
  assert.ok(rows[0].avgPct >= rows[1].avgPct);
  assert.ok('TAKE_PROFIT_X' in rows[0].rules);
});

test('the round-trip cost falls back to the measured estimate until there are real fills', () => {
  const cost = measureRoundTripCost([]);
  assert.equal(cost.measured, false);
  assert.equal(cost.costPct, DEFAULT_ROUND_TRIP_COST_PCT);
});

test('the round-trip cost is measured from real fills once there are enough', () => {
  const trades = Array.from({ length: 6 }, () => ({
    features: { priceUsd: 0.001 },
    entryPriceUsd: 0.00104,
    exitMarketPriceUsd: 0.002,
    exitPriceUsd: 0.00192,
    feesUsd: 0.04,
    costUsd: 8,
  }));
  const cost = measureRoundTripCost(trades);
  assert.equal(cost.measured, true);
  assert.ok(cost.costPct > 8 && cost.costPct < 9.5, `got ${cost.costPct}`);
});

test('a runner left at the end of a path is valued at the last price', () => {
  const result = replayPath(path([1, 1.1, 1.2]), cfg, 0);
  assert.equal(result.reason, 'path_end');
  assert.ok(Math.abs(result.grossPct - 20) < 0.01);
});
