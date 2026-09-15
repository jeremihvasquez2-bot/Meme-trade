// DexScreener: the discovery feed and the price/volume truth used everywhere
// downstream. Free, no key, rate-limited politely by the 45s scan interval.
import { httpJson, httpJsonSoft } from '../http.js';
import { num, uniq } from '../util.js';

const BASE = 'https://api.dexscreener.com';

export function normalisePair(pair) {
  if (!pair || pair.chainId !== 'solana') return null;
  const txns = pair.txns || {};
  const m5 = txns.m5 || {};
  return {
    mint: pair.baseToken?.address,
    symbol: pair.baseToken?.symbol || '?',
    name: pair.baseToken?.name || '',
    pairAddress: pair.pairAddress,
    dexId: pair.dexId,
    priceUsd: num(pair.priceUsd),
    liquidityUsd: num(pair.liquidity?.usd),
    volumeH1: num(pair.volume?.h1),
    volumeM5: num(pair.volume?.m5),
    volumeH24: num(pair.volume?.h24),
    marketCap: num(pair.marketCap ?? pair.fdv),
    fdv: num(pair.fdv),
    m5: num(pair.priceChange?.m5),
    h1: num(pair.priceChange?.h1),
    h24: num(pair.priceChange?.h24),
    buysM5: num(m5.buys),
    sellsM5: num(m5.sells),
    createdAt: num(pair.pairCreatedAt),
    url: pair.url,
  };
}

/** Keep the deepest pair per mint — that is the one a swap would route through. */
export function bestPairPerMint(pairs) {
  const best = new Map();
  for (const raw of pairs || []) {
    const p = normalisePair(raw);
    if (!p?.mint) continue;
    const prev = best.get(p.mint);
    if (!prev || p.liquidityUsd > prev.liquidityUsd) best.set(p.mint, p);
  }
  return [...best.values()];
}

export async function tokenProfiles() {
  const data = await httpJsonSoft(`${BASE}/token-profiles/latest/v1`, {}, []);
  return mintsFrom(data);
}

export async function tokenBoostsLatest() {
  const data = await httpJsonSoft(`${BASE}/token-boosts/latest/v1`, {}, []);
  return mintsFrom(data);
}

export async function tokenBoostsTop() {
  const data = await httpJsonSoft(`${BASE}/token-boosts/top/v1`, {}, []);
  return mintsFrom(data);
}

function mintsFrom(data) {
  const list = Array.isArray(data) ? data : data ? [data] : [];
  return uniq(
    list
      .filter((d) => d?.chainId === 'solana' && d?.tokenAddress)
      .map((d) => d.tokenAddress),
  );
}

/** Hydrate up to 30 mints per call (DexScreener's documented limit). */
export async function hydrate(mints) {
  const out = [];
  const list = uniq(mints).filter(Boolean);
  for (let i = 0; i < list.length; i += 30) {
    const chunk = list.slice(i, i + 30);
    const data = await httpJsonSoft(`${BASE}/tokens/v1/solana/${chunk.join(',')}`, {}, []);
    out.push(...bestPairPerMint(Array.isArray(data) ? data : []));
  }
  return out;
}

/** Single-token price refresh used by the exit loop and the path recorder. */
export async function priceOf(mint) {
  const data = await httpJson(`${BASE}/tokens/v1/solana/${mint}`, { tries: 2 });
  const [best] = bestPairPerMint(Array.isArray(data) ? data : []);
  return best || null;
}
