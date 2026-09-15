import { getQuote, SOL_MINT, usdToLamportsSol } from '../research/jupiter.js';

// A Solana tx costs ~5000 lamports base fee; we add a modest priority-fee
// estimate on top so paper fees track the real ~8-9% round-trip cost on a
// small buy instead of a made-up flat percentage.
const BASE_FEE_LAMPORTS = 5000;
const PRIORITY_FEE_LAMPORTS = 20_000;

function estimatedNetworkFeeUsd(solUsd) {
  return ((BASE_FEE_LAMPORTS + PRIORITY_FEE_LAMPORTS) / 1e9) * solUsd;
}

// Buys `sizeUsd` worth of `mint` using a real Jupiter SOL->token quote.
// Returns { tokenAmount, priceUsd, amountUsd, feeUsd } for positions.openPosition.
export async function buyPaper({ mint, decimals, sizeUsd, solUsd }) {
  const lamports = usdToLamportsSol(sizeUsd, solUsd);
  const quote = await getQuote({ inputMint: SOL_MINT, outputMint: mint, amount: lamports });
  const tokenAmount = Number(quote.outAmount) / 10 ** decimals;
  if (!(tokenAmount > 0)) throw new Error('paper buy: no route/liquidity for quote');
  const feeUsd = estimatedNetworkFeeUsd(solUsd);
  const amountUsd = sizeUsd + feeUsd; // true cash cost including fee
  return { tokenAmount, priceUsd: amountUsd / tokenAmount, amountUsd, feeUsd };
}

// Sells `tokenAmount` of `mint` using a real Jupiter token->SOL quote.
// Returns { tokenAmount, priceUsd, amountUsd, feeUsd } for positions.applySellFill.
export async function sellPaper({ mint, decimals, tokenAmount, solUsd }) {
  const atoms = Math.floor(tokenAmount * 10 ** decimals);
  if (atoms <= 0) return { tokenAmount: 0, priceUsd: 0, amountUsd: 0, feeUsd: 0 };
  const quote = await getQuote({ inputMint: mint, outputMint: SOL_MINT, amount: atoms });
  const solOut = Number(quote.outAmount) / 1e9;
  const feeUsd = estimatedNetworkFeeUsd(solUsd);
  const amountUsd = Math.max(0, solOut * solUsd - feeUsd);
  return { tokenAmount, priceUsd: amountUsd / tokenAmount, amountUsd, feeUsd };
}
