import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPosition, applySellFill, isFullyClosed, toClosedTrade } from '../src/execution/positions.js';

test('a full exit in one fill closes the position and computes P&L on the whole trade', () => {
  const pos = openPosition({ mint: 'A', symbol: 'A', source: 'scan', round: 1, sizeUsd: 8, tokenAmount: 100, priceUsd: 0.08, feeUsd: 0.05 });
  applySellFill(pos, { tokenAmount: 100, priceUsd: 0.2, amountUsd: 19, feeUsd: 0.1 });

  assert.equal(isFullyClosed(pos), true);
  const trade = toClosedTrade(pos, 'take_profit');
  assert.equal(trade.pnlUsd, 11); // 19 proceeds - 8 cost basis
  assert.equal(trade.outcome, 'WIN');
});

test('a partial sell followed by a full exit is judged on the whole trade, not the last sale', () => {
  const pos = openPosition({ mint: 'A', symbol: 'A', source: 'scan', round: 1, sizeUsd: 8, tokenAmount: 100, priceUsd: 0.08 });
  applySellFill(pos, { tokenAmount: 75, priceUsd: 0.2, amountUsd: 15, feeUsd: 0 }); // conviction hold partial
  assert.equal(isFullyClosed(pos), false);

  // price crashes on the remaining 25% and it exits at a small loss on that slice
  applySellFill(pos, { tokenAmount: 25, priceUsd: 0.05, amountUsd: 1.2, feeUsd: 0 });
  assert.equal(isFullyClosed(pos), true);

  const trade = toClosedTrade(pos, 'trailing_stop');
  assert.equal(trade.proceedsUsd, 16.2);
  assert.equal(trade.pnlUsd, 8.2); // still a WIN overall despite the losing final slice
  assert.equal(trade.outcome, 'WIN');
});

test('a losing whole trade is judged LOSE even if an early partial sale was profitable', () => {
  const pos = openPosition({ mint: 'A', symbol: 'A', source: 'scan', round: 1, sizeUsd: 100, tokenAmount: 100, priceUsd: 1 });
  applySellFill(pos, { tokenAmount: 10, priceUsd: 3, amountUsd: 30, feeUsd: 0 }); // small profitable partial
  applySellFill(pos, { tokenAmount: 90, priceUsd: 0.2, amountUsd: 18, feeUsd: 0 }); // rest dumped at a loss

  const trade = toClosedTrade(pos, 'stop_loss');
  assert.equal(trade.proceedsUsd, 48);
  assert.equal(trade.pnlUsd, -52);
  assert.equal(trade.outcome, 'LOSE');
});
