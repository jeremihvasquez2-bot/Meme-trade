import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordTrade, readTrades, summarize, isoWeek } from '../src/money/ledger.js';
import { tmpConfig, makeTrade } from './helpers.js';

test('ledger tallies made/lost/net and win/loss counts', () => {
  const config = tmpConfig();
  recordTrade(config.dataDir, makeTrade({ pnlUsd: 10, mint: 'A' }));
  recordTrade(config.dataDir, makeTrade({ pnlUsd: -4, mint: 'B' }));
  recordTrade(config.dataDir, makeTrade({ pnlUsd: 6, mint: 'C' }));

  const trades = readTrades(config.dataDir);
  const summary = summarize(trades);

  assert.equal(summary.closedCount, 3);
  assert.equal(summary.made, 16);
  assert.equal(summary.lost, 4);
  assert.equal(summary.net, 12);
  assert.equal(summary.wins, 2);
  assert.equal(summary.losses, 1);
});

test('summarize tracks profitable ISO weeks separately', () => {
  const config = tmpConfig();
  const weekAgoMs = Date.now() - 8 * 86400000;
  recordTrade(config.dataDir, makeTrade({ pnlUsd: 5, mint: 'A', closedAt: weekAgoMs }));
  recordTrade(config.dataDir, makeTrade({ pnlUsd: 5, mint: 'B', closedAt: Date.now() }));

  const summary = summarize(readTrades(config.dataDir));
  assert.equal(summary.profitableWeeks, 2);
  assert.notEqual(isoWeek(weekAgoMs), isoWeek(Date.now()));
});
