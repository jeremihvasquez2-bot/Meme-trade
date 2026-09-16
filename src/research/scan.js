import { getTokenProfilesLatest, getTokenBoosts, hydrateTokens, toFeatures } from './dexscreener.js';
import { getTrendingPools, getNewPools, baseMint } from './geckoterminal.js';
import { getRugcheckSummary } from './rugcheck.js';
import { getMintAuthorities } from './rpc.js';
import { estimateSellPriceImpactPct, getSolUsdPrice } from './jupiter.js';
import { passesFilters } from './filters.js';
import { scoreCandidate } from './scoring.js';
import { getSmartMoneyCount } from '../copytrade/follow.js';

async function collectCandidateMints() {
  const [profiles, boostsLatest, boostsTop, trending, newPools] = await Promise.all([
    getTokenProfilesLatest(),
    getTokenBoosts('latest'),
    getTokenBoosts('top'),
    getTrendingPools(),
    getNewPools(),
  ]);

  const mints = new Set();
  for (const t of [...profiles, ...boostsLatest, ...boostsTop]) {
    if (t.tokenAddress) mints.add(t.tokenAddress);
  }
  for (const pool of [...trending, ...newPools]) {
    const mint = baseMint(pool);
    if (mint) mints.add(mint);
  }
  return [...mints];
}

// Runs one full scan: discover -> hydrate -> cheap filters -> expensive
// safety checks -> score. Returns { buyCandidates, shadowCandidates } sorted
// by score descending; shadowCandidates are ones that passed safety but
// didn't reach the buy threshold (still worth recording a path for).
export async function runScan(config) {
  const mints = await collectCandidateMints();
  if (!mints.length) return { buyCandidates: [], shadowCandidates: [] };

  const pairs = await hydrateTokens(mints);
  const rules = config.rules;
  const cheapPassed = [];

  for (const pair of pairs) {
    const features = toFeatures(pair);
    if (!features.mint || !features.priceUsd) continue;
    if (features.ageMs === undefined) continue;
    const { passed } = passesFilters(
      { ...features, mintAuthorityRevoked: true, freezeAuthorityRevoked: true, rugcheckScore: 0, sellPriceImpactPct: 0 },
      rules.filters,
    );
    // (authorities/rugcheck/sell-impact are checked for real just below; the
    // call above only screens the cheap numeric fields so we don't waste
    // RPC/RugCheck/Jupiter calls on tokens that fail liquidity/volume/age anyway)
    if (passed) cheapPassed.push(features);
  }

  const solUsd = await getSolUsdPrice().catch(() => null);
  const results = [];

  for (const features of cheapPassed.slice(0, 60)) {
    const [authorities, rugcheck] = await Promise.all([
      getMintAuthorities(config, features.mint),
      getRugcheckSummary(features.mint),
    ]);
    if (!authorities || !rugcheck) continue;

    const sizeUsd = Math.min(rules.positionMaxUsd, Math.max(rules.positionMinUsd, config.bankrollUsd * rules.positionSizePct));
    const sellPriceImpactPct = solUsd
      ? await estimateSellPriceImpactPct({
          mint: features.mint,
          priceUsd: features.priceUsd,
          decimals: authorities.decimals ?? 9,
          sizeUsd,
          solUsd,
        })
      : null;

    const full = {
      ...features,
      mintAuthorityRevoked: authorities.mintAuthorityRevoked,
      freezeAuthorityRevoked: authorities.freezeAuthorityRevoked,
      rugcheckScore: rugcheck.score,
      rugcheckRisks: rugcheck.risks,
      sellPriceImpactPct: sellPriceImpactPct ?? undefined,
      decimals: authorities.decimals,
      smartMoneyCount: getSmartMoneyCount(config.dataDir, features.mint),
    };

    const { passed, reasons } = passesFilters(full, rules.filters);
    if (!passed) continue;

    const { score, breakdown } = scoreCandidate(full);
    results.push({ features: full, score, breakdown, reasons });
  }

  results.sort((a, b) => b.score - a.score);
  return {
    buyCandidates: results.filter((r) => r.score >= rules.scoreBuyThreshold),
    shadowCandidates: results.filter((r) => r.score < rules.scoreBuyThreshold),
    solUsd,
  };
}
