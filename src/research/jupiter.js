import { fetchJson } from '../utils/http.js';

export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const BASE = 'https://lite-api.jup.ag';

export async function getSolUsdPrice() {
  const quote = await getQuote({ inputMint: SOL_MINT, outputMint: USDC_MINT, amount: 1e9 });
  return Number(quote.outAmount) / 1e6; // USDC has 6 decimals
}

export async function getQuote({ inputMint, outputMint, amount, slippageBps = 300 }) {
  const url = `${BASE}/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${Math.floor(amount)}&slippageBps=${slippageBps}`;
  return fetchJson(url, { retries: 1, timeoutMs: 6000 });
}

export async function buildSwapTransaction({ quoteResponse, userPublicKey, maxPriorityFeeLamports }) {
  const res = await fetch(`${BASE}/swap/v1/swap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse,
      userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: maxPriorityFeeLamports, priorityLevel: 'high' } },
    }),
  });
  if (!res.ok) throw new Error(`jupiter swap build failed: HTTP ${res.status}`);
  return res.json();
}

// Buys and sells quoted for a given USD size, in raw lamports/atoms. `decimals`
// is the token's decimals, `solUsd` the current SOL/USD price.
export function usdToLamportsSol(usd, solUsd) {
  return Math.floor((usd / solUsd) * 1e9);
}

export function usdToTokenAtoms(usd, priceUsd, decimals) {
  return Math.floor((usd / priceUsd) * 10 ** decimals);
}

// Honeypot guard: simulates selling `sizeUsd` worth of the token back to SOL
// and returns the price impact percentage, or null if no quote could be had
// (callers should treat null as "not safe to buy").
export async function estimateSellPriceImpactPct({ mint, priceUsd, decimals, sizeUsd, solUsd }) {
  try {
    const tokenAmount = usdToTokenAtoms(sizeUsd, priceUsd, decimals);
    if (tokenAmount <= 0) return null;
    const quote = await getQuote({ inputMint: mint, outputMint: SOL_MINT, amount: tokenAmount });
    const impact = Number(quote?.priceImpactPct);
    return Number.isFinite(impact) ? Math.abs(impact) * 100 : null;
  } catch {
    return null;
  }
}
