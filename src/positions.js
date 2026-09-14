import { dataPath, readJson, writeJson, appendJsonl, readJsonl } from './store.js';
import { num, round, id } from './util.js';

export function positionsFile() {
  return dataPath('positions.json');
}
export function tradesFile() {
  return dataPath('trades.jsonl');
}

export function loadPositions() {
  const list = readJson(positionsFile(), []);
  return Array.isArray(list) ? list : [];
}

export function savePositions(list) {
  writeJson(positionsFile(), list);
  return list;
}

export function loadTrades() {
  return readJsonl(tradesFile());
}

export function newPosition({ candidate, fill, sizeUsd, score, features, followers = [] }) {
  return {
    id: id('pos'),
    mint: candidate.mint,
    symbol: candidate.symbol,
    name: candidate.name,
    openedAt: Date.now(),
    sizeUsd: round(sizeUsd, 2),
    costUsd: round(fill.costUsd, 4),
    feesUsd: round(fill.feeUsd, 4),
    entryPriceUsd: fill.priceUsd,
    tokens: fill.tokens,
    rawTokens: fill.rawTokens,
    decimals: fill.decimals,
    entryTokens: fill.tokens,
    peakPriceUsd: fill.priceUsd,
    lastPriceUsd: fill.priceUsd,
    lastPriceAt: Date.now(),
    strikes: 0,
    realisedUsd: 0,
    partials: [],
    tookConviction: false,
    score,
    features,
    followers,
    entrySignature: fill.signature || null,
  };
}

/** Book a (possibly partial) sale against a position. */
export function applySale(position, sale) {
  position.tokens = Math.max(0, round(position.tokens - num(sale.tokensSold), 12));
  position.rawTokens = Math.max(0, Math.round(position.rawTokens - num(sale.rawSold)));
  position.realisedUsd = round(num(position.realisedUsd) + num(sale.proceedsUsd), 4);
  position.feesUsd = round(num(position.feesUsd) + num(sale.feeUsd), 4);
  position.partials.push({
    at: Date.now(),
    reason: sale.reason,
    fraction: round(num(sale.fraction), 4),
    tokensSold: sale.tokensSold,
    proceedsUsd: round(num(sale.proceedsUsd), 4),
    priceUsd: sale.priceUsd,
    signature: sale.signature || null,
  });
  return position;
}

export function isClosed(position) {
  // Dust below a cent of entry value is not worth another swap's fees.
  const dustUsd = num(position.tokens) * num(position.lastPriceUsd || position.entryPriceUsd);
  return position.forceClosed === true || position.tokens <= 0 || dustUsd < 0.01;
}

/**
 * The whole trade decides WIN or LOSE — not the last partial sale. Selling 75%
 * at 2.5x and riding the rest to zero is still a win, and the alert must say so.
 */
export function closeTrade(position, { reason, closedAt = Date.now() } = {}) {
  const proceeds = round(num(position.realisedUsd), 4);
  const pnlUsd = round(proceeds - num(position.costUsd), 4);
  const peakMultiple = round(num(position.peakPriceUsd) / num(position.entryPriceUsd || 1), 3);
  return {
    id: position.id,
    mint: position.mint,
    symbol: position.symbol,
    name: position.name,
    openedAt: position.openedAt,
    closedAt,
    holdMs: closedAt - position.openedAt,
    sizeUsd: position.sizeUsd,
    costUsd: round(num(position.costUsd), 4),
    proceedsUsd: proceeds,
    pnlUsd,
    pnlPct: round((pnlUsd / Math.max(0.01, num(position.costUsd))) * 100, 2),
    feesUsd: round(num(position.feesUsd), 4),
    outcome: pnlUsd >= 0 ? 'WIN' : 'LOSE',
    reason,
    peakMultiple,
    entryPriceUsd: position.entryPriceUsd,
    exitPriceUsd: position.lastPriceUsd,
    score: position.score,
    features: position.features,
    followers: position.followers || [],
    partials: position.partials,
  };
}

export function recordTrade(trade) {
  appendJsonl(tradesFile(), trade);
  return trade;
}
