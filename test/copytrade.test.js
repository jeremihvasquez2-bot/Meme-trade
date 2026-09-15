import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qualifyWallet } from '../src/copytrade/wallets.js';
import { DEFAULT_RULES } from '../src/config.js';

const SOL = 'So11111111111111111111111111111111111111112';

function buildTrades(n, { holdMin, winRate }) {
  const trades = [];
  let ts = Date.now() - n * 3_600_000;
  for (let i = 0; i < n; i++) {
    const mint = `TOKEN${i}`;
    const win = i < Math.round(n * winRate);
    trades.push({ from: { address: SOL }, to: { address: mint }, time: ts, volume: { usd: 10 } });
    ts += holdMin * 60_000;
    trades.push({ from: { address: mint }, to: { address: SOL }, time: ts, volume: { usd: win ? 15 : 5 } });
    ts += 3_600_000;
  }
  return trades;
}

test('qualifies a wallet that clears all three copy-trade thresholds', () => {
  const trades = buildTrades(20, { holdMin: 30, winRate: 0.6 });
  const result = qualifyWallet(trades, DEFAULT_RULES.copytrade);
  assert.ok(result);
  assert.equal(result.roundTrips, 20);
  assert.ok(result.winRate >= DEFAULT_RULES.copytrade.minWinRate);
});

test('rejects a wallet with too few round trips', () => {
  const trades = buildTrades(5, { holdMin: 30, winRate: 0.8 });
  const result = qualifyWallet(trades, DEFAULT_RULES.copytrade);
  assert.equal(result, null);
});

test('rejects a scalper wallet whose median hold is too short', () => {
  const trades = buildTrades(20, { holdMin: 1, winRate: 0.8 });
  const result = qualifyWallet(trades, DEFAULT_RULES.copytrade);
  assert.equal(result, null);
});

test('rejects a wallet with a losing win rate', () => {
  const trades = buildTrades(20, { holdMin: 30, winRate: 0.3 });
  const result = qualifyWallet(trades, DEFAULT_RULES.copytrade);
  assert.equal(result, null);
});
