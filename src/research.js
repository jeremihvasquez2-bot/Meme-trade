// The scan: gather everything Solana is talking about, throw away almost all
// of it, and score what survives.
import { cfg } from './config.js';
import { log } from './log.js';
import * as dex from './sources/dexscreener.js';
import * as gecko from './sources/geckoterminal.js';
import * as rugcheck from './sources/rugcheck.js';
import * as jup from './sources/jupiter.js';
import * as rpc from './sources/rpc.js';
import { marketFilters, authorityCheck, sellabilityCheck } from './filters.js';
import { scoreCandidate } from './scoring.js';
import { num, round, uniq, HOUR } from './util.js';

export async function gatherMints(extraMints = []) {
  const batches = await Promise.all([
    dex.tokenProfiles(),
    dex.tokenBoostsLatest(),
    dex.tokenBoostsTop(),
    gecko.trending(),
    gecko.newPools(),
  ]);
  return uniq([...extraMints, ...batches.flat()]).filter(Boolean);
}

/**
 * The expensive checks, in the order that throws work away fastest: on-chain
 * authorities, then RugCheck, then a real Jupiter sell quote for OUR size.
 */
export async function safetyCheck(candidate, sizeUsd) {
  const info = await rpc.mintInfo(candidate.mint);
  const authorities = authorityCheck(info);
  if (!authorities.pass) return { pass: false, fails: authorities.fails, info };

  const summary = await rugcheck.summary(candidate.mint);
  const verdict = rugcheck.judge(summary, cfg.MAX_RUGCHECK_SCORE);
  if (!verdict.ok) return { pass: false, fails: [verdict.reason], info, rugcheckScore: verdict.score };

  const sellQuote = await jup.sellQuoteFor({
    mint: candidate.mint,
    decimals: info.decimals,
    priceUsd: candidate.priceUsd,
    sizeUsd,
  });
  const sellable = sellabilityCheck(sellQuote);
  if (!sellable.pass) return { pass: false, fails: sellable.fails, info, rugcheckScore: verdict.score };

  return {
    pass: true,
    fails: [],
    info,
    decimals: info.decimals,
    rugcheckScore: verdict.score,
    sellImpactPct: round(num(sellQuote.priceImpactPct), 3),
  };
}

export function entryFeatures(candidate, safety, now = Date.now()) {
  return {
    priceUsd: num(candidate.priceUsd),
    liquidityUsd: round(num(candidate.liquidityUsd)),
    volumeH1: round(num(candidate.volumeH1)),
    volumeM5: round(num(candidate.volumeM5)),
    marketCap: round(num(candidate.marketCap)),
    ageHours: round((now - num(candidate.createdAt)) / HOUR, 2),
    m5: num(candidate.m5),
    h1: num(candidate.h1),
    buysM5: num(candidate.buysM5),
    sellsM5: num(candidate.sellsM5),
    buySellM5: num(candidate.sellsM5) ? round(num(candidate.buysM5) / num(candidate.sellsM5), 2) : num(candidate.buysM5),
    rugcheckScore: num(safety.rugcheckScore),
    sellImpactPct: num(safety.sellImpactPct),
    smartMoneyCount: num(candidate.smartMoneyCount),
  };
}

/**
 * One full scan. Returns candidates that passed EVERYTHING, ranked, plus the
 * hydrated universe (used to seed copy-trade discovery).
 */
export async function scan({ sizeUsd, smartMoney = new Map(), neverBuy = new Set(), now = Date.now() } = {}) {
  const mints = await gatherMints([...smartMoney.keys()]);
  const universe = await dex.hydrate(mints);
  log.debug(`scan: ${mints.length} mints → ${universe.length} hydrated`);

  const shortlist = [];
  for (const candidate of universe) {
    if (neverBuy.has(candidate.mint)) continue;
    const market = marketFilters(candidate, now);
    if (!market.pass) continue;
    candidate.smartMoneyCount = num(smartMoney.get(candidate.mint));
    shortlist.push(candidate);
  }
  // Cheap ranking first so the expensive safety checks run on the best only.
  shortlist.sort((a, b) => scoreCandidate(b, now).total - scoreCandidate(a, now).total);

  const passed = [];
  for (const candidate of shortlist.slice(0, 12)) {
    const safety = await safetyCheck(candidate, sizeUsd);
    if (!safety.pass) {
      log.debug(`rejected ${candidate.symbol}: ${safety.fails.join('; ')}`);
      continue;
    }
    candidate.decimals = safety.decimals;
    candidate.rugcheckScore = safety.rugcheckScore;
    candidate.sellImpactPct = safety.sellImpactPct;
    const scored = scoreCandidate(candidate, now);
    candidate.score = scored.total;
    candidate.scoreParts = scored.parts;
    candidate.features = entryFeatures(candidate, safety, now);
    passed.push(candidate);
  }

  passed.sort((a, b) => b.score - a.score);
  return { universe, shortlist, passed };
}

export function whyBought(candidate) {
  const parts = candidate.scoreParts || {};
  const f = candidate.features || {};
  const lines = [
    `Score **${candidate.score}** (momentum ${parts.momentum}, buy pressure ${parts.buyPressure}, turnover ${parts.turnover}, safety ${parts.safety}, age ${parts.age}).`,
    `Liquidity $${f.liquidityUsd}, 1h volume $${f.volumeH1}, market cap $${f.marketCap}, ${f.ageHours}h old.`,
    `5m ${f.m5}% with ${f.buysM5} buys to ${f.sellsM5} sells (${f.buySellM5}:1).`,
  ];
  if (num(candidate.smartMoneyCount) > 0) {
    lines.push(`${candidate.smartMoneyCount} followed wallet(s) were holding it.`);
  }
  return lines.join(' ');
}
