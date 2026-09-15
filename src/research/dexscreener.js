import { fetchJson } from '../utils/http.js';

const BASE = 'https://api.dexscreener.com';

export async function getTokenProfilesLatest() {
  try {
    const data = await fetchJson(`${BASE}/token-profiles/latest/v1`);
    return (Array.isArray(data) ? data : []).filter((t) => t.chainId === 'solana');
  } catch {
    return [];
  }
}

export async function getTokenBoosts(kind = 'latest') {
  try {
    const data = await fetchJson(`${BASE}/token-boosts/${kind}/v1`);
    return (Array.isArray(data) ? data : []).filter((t) => t.chainId === 'solana');
  } catch {
    return [];
  }
}

// Hydrates up to 30 mints at a time with full pair data (liquidity, volume, etc).
export async function hydrateTokens(mints) {
  const out = [];
  for (let i = 0; i < mints.length; i += 30) {
    const batch = mints.slice(i, i + 30);
    try {
      const data = await fetchJson(`${BASE}/tokens/v1/solana/${batch.join(',')}`);
      if (Array.isArray(data)) out.push(...data);
    } catch {
      // skip this batch, keep going
    }
  }
  return out;
}

// Normalizes a DexScreener pair object into the flat features shape the
// filters/scoring modules expect.
export function toFeatures(pair) {
  const now = Date.now();
  return {
    mint: pair.baseToken?.address,
    symbol: pair.baseToken?.symbol,
    priceUsd: Number(pair.priceUsd) || 0,
    liquidityUsd: pair.liquidity?.usd ?? 0,
    volume1hUsd: pair.volume?.h1 ?? 0,
    volume5mUsd: pair.volume?.m5 ?? 0,
    mcapUsd: pair.marketCap ?? pair.fdv ?? 0,
    ageMs: pair.pairCreatedAt ? now - pair.pairCreatedAt : undefined,
    m5Pct: pair.priceChange?.m5 ?? 0,
    h1Pct: pair.priceChange?.h1 ?? 0,
    buySellRatio5m: pair.txns?.m5 ? safeRatio(pair.txns.m5.buys, pair.txns.m5.sells) : undefined,
    buys5m: pair.txns?.m5?.buys,
    sells5m: pair.txns?.m5?.sells,
    dexUrl: pair.url,
    pairAddress: pair.pairAddress,
  };
}

function safeRatio(buys, sells) {
  if (!sells) return buys > 0 ? 10 : 0;
  return buys / sells;
}
