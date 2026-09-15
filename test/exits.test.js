import test from 'node:test';
import assert from 'node:assert/strict';
import './helper.js';
import { freshData, cleanup } from './helper.js';
import { cfg } from '../src/config.js';
import { decideExit, strongPressure } from '../src/exits.js';
import { HOUR, MINUTE } from '../src/util.js';

test.beforeEach(() => freshData());
test.after(cleanup);

const position = (over = {}) => ({
  entryPriceUsd: 1,
  openedAt: Date.now() - 30 * MINUTE,
  peakPriceUsd: 1,
  strikes: 0,
  tookConviction: false,
  ...over,
});
const tick = (price, over = {}) => ({ priceUsd: price, m5: 1, buysM5: 10, sellsM5: 10, volumeM5: 1000, ...over });

test('a quiet position in the middle is held', () => {
  const d = decideExit(position(), tick(1.3));
  assert.equal(d.action, 'hold');
});

test('2.5x with ordinary pressure sells the lot', () => {
  const d = decideExit(position(), tick(2.5));
  assert.equal(d.action, 'sell');
  assert.equal(d.fraction, 1);
  assert.equal(d.reason, 'take_profit');
});

test('2.5x with the crowd still buying sells 75% and lets 25% ride', () => {
  const d = decideExit(position(), tick(2.6, { m5: 6, buysM5: 40, sellsM5: 10, volumeM5: 9000 }));
  assert.equal(d.reason, 'take_profit_partial');
  assert.equal(d.fraction, 0.75);
});

test('once the runner is riding, take-profit does not fire again', () => {
  const d = decideExit(position({ tookConviction: true, peakPriceUsd: 3 }), tick(3));
  assert.equal(d.action, 'hold');
});

test('the 25% runner still exits on the trailing stop', () => {
  const d = decideExit(position({ tookConviction: true, peakPriceUsd: 4 }), tick(2.5));
  assert.equal(d.reason, 'trailing_stop');
});

test('the stop loss fires at -25%', () => {
  assert.equal(decideExit(position(), tick(0.76)).action, 'hold');
  assert.equal(decideExit(position(), tick(0.75)).reason, 'stop_loss');
});

test('the trailing stop fires 30% below the peak', () => {
  const p = position({ peakPriceUsd: 2 });
  assert.equal(decideExit(p, tick(1.39)).reason, 'trailing_stop');
  assert.equal(decideExit(p, tick(1.45)).action, 'hold');
});

test('the trailing stop cannot fire on a position that never went up', () => {
  const d = decideExit(position({ peakPriceUsd: 1 }), tick(0.9));
  assert.equal(d.action, 'hold');
});

test('a position is closed out after the 4 hour limit', () => {
  const d = decideExit(position({ openedAt: Date.now() - 4 * HOUR - 1000 }), tick(1.1));
  assert.equal(d.reason, 'max_hold');
});

test('a missing price is a strike, not a rug', () => {
  const d = decideExit(position({ strikes: 2 }), null);
  assert.equal(d.action, 'hold');
  assert.match(d.reason, /strike 2\/5/);
});

test('five strikes in a row and we get out anyway', () => {
  const d = decideExit(position({ strikes: cfg.MAX_PRICE_STRIKES }), null);
  assert.equal(d.reason, 'no_price_bailout');
  assert.equal(d.fraction, 1);
});

test('conviction needs buy pressure AND momentum AND volume', () => {
  assert.equal(strongPressure({ buysM5: 40, sellsM5: 10, m5: 6, volumeM5: 9000 }), true);
  assert.equal(strongPressure({ buysM5: 12, sellsM5: 10, m5: 6, volumeM5: 9000 }), false);
  assert.equal(strongPressure({ buysM5: 40, sellsM5: 10, m5: 1, volumeM5: 9000 }), false);
  assert.equal(strongPressure({ buysM5: 40, sellsM5: 10, m5: 6, volumeM5: 100 }), false);
  assert.equal(strongPressure(null), false);
});

test('replay can override the rules without touching the live config', () => {
  const d = decideExit(position(), tick(2.0), Date.now(), { ...cfg, TAKE_PROFIT_X: 2 });
  assert.equal(d.reason, 'take_profit');
  assert.equal(decideExit(position(), tick(2.0)).action, 'hold');
});

test('take profit is checked before the stop loss can be confused by a gap', () => {
  const d = decideExit(position({ peakPriceUsd: 3 }), tick(2.6));
  assert.equal(d.reason, 'take_profit');
});
