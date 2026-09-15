import { fetchJson } from '../utils/http.js';

const BASE = 'https://api.geckoterminal.com/api/v2';

async function pool(kind, page) {
  try {
    const data = await fetchJson(`${BASE}/networks/solana/${kind}?page=${page}`, {
      headers: { Accept: 'application/json;version=20230302' },
    });
    return data?.data ?? [];
  } catch {
    return [];
  }
}

export async function getTrendingPools() {
  const pages = await Promise.all([pool('trending_pools', 1), pool('trending_pools', 2)]);
  return pages.flat();
}

export async function getNewPools() {
  const pages = await Promise.all([pool('new_pools', 1), pool('new_pools', 2), pool('new_pools', 3)]);
  return pages.flat();
}

// Pulls the base-token mint address out of a GeckoTerminal pool object.
export function baseMint(poolObj) {
  const rel = poolObj?.relationships?.base_token?.data?.id; // e.g. "solana_<mint>"
  if (!rel) return null;
  const parts = rel.split('_');
  return parts.slice(1).join('_') || null;
}
