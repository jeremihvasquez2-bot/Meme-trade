// A fake Solana. Enough of DexScreener, GeckoTerminal, RugCheck, Jupiter and
// the RPC to drive a whole trade end to end without touching the network.
import { setFetch, resetFetch } from '../src/http.js';
import { setSolPriceCache } from '../src/sources/jupiter.js';
import { SOL_MINT, HOUR } from '../src/util.js';

export const MINT = 'Mint1111111111111111111111111111111111111111';

export function fakeMarket(over = {}) {
  return {
    mint: MINT,
    symbol: 'TEST',
    priceUsd: 0.001,
    solPrice: 200,
    decimals: 6,
    liquidityUsd: 60_000,
    volumeH1: 90_000,
    volumeM5: 9_000,
    marketCap: 500_000,
    m5: 6,
    h1: 25,
    buysM5: 60,
    sellsM5: 20,
    ageMs: 3 * HOUR,
    rugcheckScore: 250,
    risks: [],
    mintAuthority: null,
    freezeAuthority: null,
    impact: 0.02,
    dead: false,
    ...over,
  };
}

function pair(market) {
  return {
    chainId: 'solana',
    pairAddress: 'Pair1',
    dexId: 'raydium',
    baseToken: { address: market.mint, symbol: market.symbol, name: `${market.symbol} token` },
    priceUsd: String(market.priceUsd),
    liquidity: { usd: market.liquidityUsd },
    volume: { h1: market.volumeH1, m5: market.volumeM5, h24: market.volumeH1 * 10 },
    marketCap: market.marketCap,
    fdv: market.marketCap,
    priceChange: { m5: market.m5, h1: market.h1, h24: market.h1 },
    txns: { m5: { buys: market.buysM5, sells: market.sellsM5 } },
    pairCreatedAt: Date.now() - market.ageMs,
  };
}

/** Install the fake. Mutate the returned market object to move the price. */
export function installMarket(market = fakeMarket()) {
  setSolPriceCache(0, 0);
  const calls = [];
  setFetch(async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url, method: opts.method || 'GET', body });
    const reply = (value) => ({ ok: true, status: 200, text: async () => JSON.stringify(value) });

    if (url.includes('token-profiles/latest')) return reply([{ chainId: 'solana', tokenAddress: market.mint }]);
    if (url.includes('token-boosts')) return reply([]);
    if (url.includes('geckoterminal')) return reply({ data: [] });
    if (url.includes('api.dexscreener.com/tokens/v1/solana/')) {
      return reply(market.dead ? [] : [pair(market)]);
    }
    if (url.includes('rugcheck.xyz')) return reply({ score_normalised: market.rugcheckScore, risks: market.risks });
    if (url.includes('jup.ag/swap/v1/quote')) {
      const params = new URL(url).searchParams;
      const amount = Number(params.get('amount'));
      const buying = params.get('inputMint') === SOL_MINT;
      if (params.get('outputMint') === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v') {
        return reply({ inputMint: SOL_MINT, outAmount: Math.floor(market.solPrice * 1e6), priceImpactPct: '0' });
      }
      if (market.dead) return reply({});
      if (buying) {
        const usdIn = (amount / 1e9) * market.solPrice;
        const tokens = (usdIn / market.priceUsd) * (1 - market.impact);
        return reply({ outAmount: Math.floor(tokens * 10 ** market.decimals), priceImpactPct: String(market.impact) });
      }
      const tokens = amount / 10 ** market.decimals;
      const usdOut = tokens * market.priceUsd * (1 - market.impact);
      return reply({ outAmount: Math.floor((usdOut / market.solPrice) * 1e9), priceImpactPct: String(market.impact) });
    }
    if (body?.method === 'getAccountInfo') {
      return reply({
        result: {
          value: {
            data: { parsed: { info: { decimals: market.decimals, supply: '1000000000', mintAuthority: market.mintAuthority, freezeAuthority: market.freezeAuthority } } },
          },
        },
      });
    }
    if (body?.method === 'getTokenAccountsByOwner') return reply({ result: { value: [] } });
    if (body?.method === 'getBalance') return reply({ result: { value: 2e9 } });
    return reply(null);
  });
  return { market, calls, restore: resetFetch };
}
