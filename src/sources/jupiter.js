// Jupiter is the price oracle AND the execution venue. Paper fills are priced
// off the same quotes a live fill would get, so paper P&L is honest about
// slippage instead of assuming a flat percentage.
import { httpJson } from '../http.js';
import { num, SOL_MINT, USDC_MINT } from '../util.js';
import { cfg } from '../config.js';

const BASE = 'https://lite-api.jup.ag/swap/v1';

export async function quote({ inputMint, outputMint, amount, slippageBps = cfg.SLIPPAGE_BPS }) {
  const raw = BigInt(Math.max(0, Math.floor(Number(amount)))).toString();
  const url =
    `${BASE}/quote?inputMint=${inputMint}&outputMint=${outputMint}` +
    `&amount=${raw}&slippageBps=${slippageBps}&restrictIntermediateTokens=true`;
  const data = await httpJson(url, { tries: 2, timeoutMs: 12000 });
  if (!data?.outAmount) throw new Error('jupiter: no route');
  return {
    inputMint: data.inputMint,
    outputMint: data.outputMint,
    inAmount: num(data.inAmount),
    outAmount: num(data.outAmount),
    priceImpactPct: Math.abs(num(data.priceImpactPct) * 100),
    raw: data,
  };
}

/** A quote that fails (no route, dead pool) is a `null`, not an exception. */
export async function quoteSoft(args) {
  try {
    return await quote(args);
  } catch {
    return null;
  }
}

let solPriceCache = { value: 0, at: 0 };

/** SOL/USD from a real 1 SOL -> USDC route. Cached for a minute. */
export async function solPriceUsd({ maxAgeMs = 60_000 } = {}) {
  if (solPriceCache.value && Date.now() - solPriceCache.at < maxAgeMs) return solPriceCache.value;
  const q = await quote({ inputMint: SOL_MINT, outputMint: USDC_MINT, amount: 1e9, slippageBps: 50 });
  const price = q.outAmount / 1e6;
  if (price > 0) solPriceCache = { value: price, at: Date.now() };
  return price;
}

export function setSolPriceCache(value, at = Date.now()) {
  solPriceCache = { value, at };
}

/**
 * The honeypot check: can we actually get this size back OUT of the token at
 * an acceptable price? A token you can buy but not sell is the classic rug.
 */
export async function sellQuoteFor({ mint, decimals, priceUsd, sizeUsd }) {
  if (!(priceUsd > 0)) return null;
  const tokens = sizeUsd / priceUsd;
  const amount = Math.floor(tokens * 10 ** decimals);
  if (!(amount > 0)) return null;
  return quoteSoft({ inputMint: mint, outputMint: SOL_MINT, amount });
}

export async function buildSwap({ quoteResponse, userPublicKey }) {
  return httpJson(`${BASE}/swap`, {
    method: 'POST',
    tries: 2,
    timeoutMs: 20000,
    body: {
      quoteResponse,
      userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: {
        priorityLevelWithMaxLamports: {
          maxLamports: cfg.PRIORITY_FEE_MAX_LAMPORTS,
          priorityLevel: 'high',
        },
      },
    },
  });
}
