import test from 'node:test';
import assert from 'node:assert/strict';
import './helper.js';
import { freshData, cleanup, candidate } from './helper.js';
import { newPosition, applySale, isClosed, closeTrade, recordTrade, loadTrades } from '../src/positions.js';

test.beforeEach(() => freshData());
test.after(cleanup);

const fill = { tokens: 8000, rawTokens: 8_000_000_000, decimals: 6, priceUsd: 0.001, feeUsd: 0.42, costUsd: 8.42 };
const open = () => newPosition({ candidate: candidate(), fill, sizeUsd: 8, score: 72, features: { liquidityUsd: 50000 } });

test('a new position records what it cost and what it bought', () => {
  const p = open();
  assert.equal(p.tokens, 8000);
  assert.equal(p.costUsd, 8.42);
  assert.equal(p.entryPriceUsd, 0.001);
  assert.equal(p.peakPriceUsd, 0.001);
  assert.equal(p.realisedUsd, 0);
  assert.equal(p.tookConviction, false);
});

test('a partial sale reduces the bag and books the proceeds', () => {
  const p = open();
  applySale(p, { fraction: 0.75, tokensSold: 6000, rawSold: 6_000_000_000, proceedsUsd: 15, feeUsd: 0.02, priceUsd: 0.0025, reason: 'take_profit_partial' });
  assert.equal(p.tokens, 2000);
  assert.equal(p.realisedUsd, 15);
  assert.equal(p.partials.length, 1);
  assert.equal(isClosed(p), false);
});

test('a position is closed once the bag is dust', () => {
  const p = open();
  applySale(p, { fraction: 1, tokensSold: 8000, rawSold: 8_000_000_000, proceedsUsd: 7, feeUsd: 0.02, priceUsd: 0.000875, reason: 'stop_loss' });
  assert.equal(isClosed(p), true);
});

test('WIN or LOSE is judged on the whole trade, not the last sale', () => {
  const p = open();
  // 75% out at 2.5x, then the runner goes to nothing.
  applySale(p, { fraction: 0.75, tokensSold: 6000, rawSold: 6e9, proceedsUsd: 15, feeUsd: 0.02, priceUsd: 0.0025, reason: 'take_profit_partial' });
  p.tookConviction = true;
  applySale(p, { fraction: 1, tokensSold: 2000, rawSold: 2e9, proceedsUsd: 0.2, feeUsd: 0.02, priceUsd: 0.0001, reason: 'trailing_stop' });
  const trade = closeTrade(p, { reason: 'trailing_stop' });
  assert.equal(trade.outcome, 'WIN');
  assert.ok(trade.pnlUsd > 6, `expected a clear win, got ${trade.pnlUsd}`);
});

test('a losing trade is a LOSE even if the last sale was a rally', () => {
  const p = open();
  applySale(p, { fraction: 0.5, tokensSold: 4000, rawSold: 4e9, proceedsUsd: 1, feeUsd: 0.02, priceUsd: 0.00025, reason: 'stop_loss' });
  applySale(p, { fraction: 1, tokensSold: 4000, rawSold: 4e9, proceedsUsd: 3, feeUsd: 0.02, priceUsd: 0.00075, reason: 'stop_loss' });
  const trade = closeTrade(p, { reason: 'stop_loss' });
  assert.equal(trade.outcome, 'LOSE');
  assert.equal(trade.proceedsUsd, 4);
  assert.equal(trade.pnlUsd, -4.42);
});

test('the peak multiple survives into the trade record', () => {
  const p = open();
  p.peakPriceUsd = 0.004;
  applySale(p, { fraction: 1, tokensSold: 8000, rawSold: 8e9, proceedsUsd: 20, feeUsd: 0.02, priceUsd: 0.0025, reason: 'trailing_stop' });
  const trade = closeTrade(p, { reason: 'trailing_stop' });
  assert.equal(trade.peakMultiple, 4);
  assert.equal(trade.pnlPct, Math.round(((20 - 8.42) / 8.42) * 10000) / 100);
});

test('fees accumulate across every sale', () => {
  const p = open();
  applySale(p, { fraction: 0.5, tokensSold: 4000, rawSold: 4e9, proceedsUsd: 5, feeUsd: 0.03, priceUsd: 0.00125, reason: 'x' });
  applySale(p, { fraction: 1, tokensSold: 4000, rawSold: 4e9, proceedsUsd: 5, feeUsd: 0.03, priceUsd: 0.00125, reason: 'x' });
  assert.equal(closeTrade(p, { reason: 'x' }).feesUsd, 0.48);
});

test('closed trades are appended to the journal on disk', () => {
  const p = open();
  applySale(p, { fraction: 1, tokensSold: 8000, rawSold: 8e9, proceedsUsd: 9, feeUsd: 0.02, priceUsd: 0.001125, reason: 'take_profit' });
  recordTrade(closeTrade(p, { reason: 'take_profit' }));
  const trades = loadTrades();
  assert.equal(trades.length, 1);
  assert.equal(trades[0].symbol, 'TEST');
});
