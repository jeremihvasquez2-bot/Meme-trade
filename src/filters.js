// The hard filters. Every one of these must pass; there is no "close enough".
// They are pure functions of an already-hydrated candidate so the test suite
// can hammer them without touching the network.
import { cfg } from './config.js';
import { num, safeDiv, HOUR, MINUTE } from './util.js';

export function ageMs(candidate, now = Date.now()) {
  return now - num(candidate.createdAt);
}

export function buySellRatioM5(candidate) {
  const buys = num(candidate.buysM5);
  const sells = num(candidate.sellsM5);
  if (sells === 0) return buys > 0 ? Number.POSITIVE_INFINITY : 0;
  return buys / sells;
}

/** Market checks only — safety (authorities, RugCheck, sellability) is async. */
export function marketFilters(candidate, now = Date.now()) {
  const fails = [];
  const liq = num(candidate.liquidityUsd);
  const vol = num(candidate.volumeH1);
  const mcap = num(candidate.marketCap);
  const age = ageMs(candidate, now);
  const ratio = buySellRatioM5(candidate);

  if (!(candidate.mint && num(candidate.priceUsd) > 0)) fails.push('no price');
  if (liq < cfg.MIN_LIQUIDITY_USD) fails.push(`liquidity $${Math.round(liq)} < $${cfg.MIN_LIQUIDITY_USD}`);
  if (liq > cfg.MAX_LIQUIDITY_USD) fails.push(`liquidity $${Math.round(liq)} > $${cfg.MAX_LIQUIDITY_USD}`);
  if (vol < cfg.MIN_VOLUME_H1_USD) fails.push(`1h volume $${Math.round(vol)} < $${cfg.MIN_VOLUME_H1_USD}`);
  if (!(age >= cfg.MIN_AGE_MINUTES * MINUTE)) fails.push(`age ${Math.round(age / MINUTE)}m < ${cfg.MIN_AGE_MINUTES}m`);
  if (age > cfg.MAX_AGE_HOURS * HOUR) fails.push(`age ${Math.round(age / HOUR)}h > ${cfg.MAX_AGE_HOURS}h`);
  if (mcap < cfg.MIN_MARKET_CAP_USD) fails.push(`mcap $${Math.round(mcap)} < $${cfg.MIN_MARKET_CAP_USD}`);
  if (mcap > cfg.MAX_MARKET_CAP_USD) fails.push(`mcap $${Math.round(mcap)} > $${cfg.MAX_MARKET_CAP_USD}`);
  if (ratio < cfg.MIN_BUY_SELL_RATIO_M5) fails.push(`5m buy/sell ${ratio.toFixed(2)} < ${cfg.MIN_BUY_SELL_RATIO_M5}`);

  return { pass: fails.length === 0, fails };
}

export function authorityCheck(info) {
  if (!info) return { pass: false, fails: ['mint account unreadable'] };
  const fails = [];
  if (!info.mintRevoked) fails.push('mint authority NOT revoked');
  if (!info.freezeRevoked) fails.push('freeze authority NOT revoked');
  return { pass: fails.length === 0, fails };
}

export function sellabilityCheck(sellQuote) {
  if (!sellQuote) return { pass: false, fails: ['no Jupiter sell route (honeypot?)'] };
  const impact = num(sellQuote.priceImpactPct);
  if (impact > cfg.MAX_PRICE_IMPACT_PCT) {
    return { pass: false, fails: [`sell impact ${impact.toFixed(2)}% > ${cfg.MAX_PRICE_IMPACT_PCT}%`] };
  }
  return { pass: true, fails: [], impact };
}

export function turnover(candidate) {
  return safeDiv(num(candidate.volumeH1), num(candidate.liquidityUsd), 0);
}
