import path from 'node:path';
import { readJson, writeJson } from '../utils/store.js';

function positionsFile(dataDir) {
  return path.join(dataDir, 'positions.json');
}

export function loadPositions(config) {
  return readJson(positionsFile(config.dataDir), []);
}

export function savePositions(config, positions) {
  writeJson(positionsFile(config.dataDir), positions);
}

export function openPosition({ mint, symbol, source, round, sizeUsd, tokenAmount, priceUsd, feeUsd }) {
  return {
    id: `${mint}-${Date.now()}`,
    mint,
    symbol,
    source,
    round,
    entryPriceUsd: priceUsd,
    sizeUsd,
    tokenAmount,
    remainingTokenAmount: tokenAmount,
    peakPriceUsd: priceUsd,
    openedAt: Date.now(),
    missedPriceStrikes: 0,
    proceedsUsd: 0,
    feesUsd: feeUsd || 0,
    fills: [
      { type: 'buy', tokenAmount, priceUsd, amountUsd: sizeUsd, feeUsd: feeUsd || 0, ts: Date.now() },
    ],
  };
}

// Records a (partial or full) sell fill against a position. Returns the position,
// mutated in place. `portionSoldOfRemaining` is 0-1.
export function applySellFill(position, { tokenAmount, priceUsd, amountUsd, feeUsd }) {
  position.remainingTokenAmount = Math.max(0, position.remainingTokenAmount - tokenAmount);
  position.proceedsUsd += amountUsd;
  position.feesUsd += feeUsd || 0;
  position.fills.push({ type: 'sell', tokenAmount, priceUsd, amountUsd, feeUsd: feeUsd || 0, ts: Date.now() });
  return position;
}

export function isFullyClosed(position) {
  return position.remainingTokenAmount <= position.tokenAmount * 0.0001;
}

// Builds the ledger trade record once a position is fully closed.
export function toClosedTrade(position, exitReason) {
  const pnlUsd = position.proceedsUsd - position.sizeUsd;
  return {
    id: position.id,
    mint: position.mint,
    symbol: position.symbol,
    source: position.source,
    round: position.round,
    openedAt: position.openedAt,
    closedAt: Date.now(),
    sizeUsd: position.sizeUsd,
    proceedsUsd: position.proceedsUsd,
    pnlUsd,
    pnlPct: pnlUsd / position.sizeUsd,
    outcome: pnlUsd >= 0 ? 'WIN' : 'LOSE',
    exitReason,
    fills: position.fills,
  };
}
