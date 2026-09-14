// GeckoTerminal fills the gap DexScreener's boost feeds leave: pools that are
// trending or brand new but nobody paid to promote.
import { httpJsonSoft } from '../http.js';
import { uniq } from '../util.js';

const BASE = 'https://api.geckoterminal.com/api/v2';

export function mintsFromPools(payload) {
  const rows = payload?.data || [];
  const out = [];
  for (const row of rows) {
    const base = row?.relationships?.base_token?.data?.id || '';
    // ids look like "solana_<mint>"
    const mint = base.startsWith('solana_') ? base.slice('solana_'.length) : '';
    if (mint) out.push(mint);
  }
  return uniq(out);
}

async function pool(kind, page) {
  const data = await httpJsonSoft(
    `${BASE}/networks/solana/${kind}?page=${page}`,
    { headers: { accept: 'application/json;version=20230302' } },
    null,
  );
  return mintsFromPools(data);
}

export async function trending() {
  const pages = await Promise.all([pool('trending_pools', 1), pool('trending_pools', 2)]);
  return uniq(pages.flat());
}

export async function newPools() {
  const pages = await Promise.all([pool('new_pools', 1), pool('new_pools', 2), pool('new_pools', 3)]);
  return uniq(pages.flat());
}
