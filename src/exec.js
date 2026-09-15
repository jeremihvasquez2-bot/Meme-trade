// Fills. Paper and live share one shape so the rest of the bot cannot tell
// them apart — and paper prices come from the same Jupiter quotes a live fill
// would hit, for the exact size, so the P&L is not a fantasy.
import { cfg } from './config.js';
import { log } from './log.js';
import * as jup from './sources/jupiter.js';
import * as rpc from './sources/rpc.js';
import { loadKeypair, signSerializedTransaction } from './wallet.js';
import { num, round, sleep, SOL_MINT } from './util.js';

// Base signature fee plus a realistic "high" priority tip. The cap in config
// is what we are willing to pay; this is what a landed swap usually costs.
export const BASE_FEE_LAMPORTS = 5000;
export const TYPICAL_PRIORITY_LAMPORTS = 100_000;
// Rent for the token account, paid on the way in and returned on the way out.
export const ATA_RENT_SOL = 0.00204;

export function networkFeeUsd(solPriceUsd) {
  return round(((BASE_FEE_LAMPORTS + TYPICAL_PRIORITY_LAMPORTS) / 1e9) * num(solPriceUsd), 6);
}

export async function confirm(signature, { timeoutMs = 60000, pollMs = 2000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await rpc.signatureStatus(signature).catch(() => null);
    if (status?.err) throw new Error(`transaction failed on chain: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return status;
    await sleep(pollMs);
  }
  throw new Error(`transaction not confirmed within ${Math.round(timeoutMs / 1000)}s: ${signature}`);
}

async function swapLive(quote) {
  const keypair = loadKeypair();
  const built = await jup.buildSwap({ quoteResponse: quote.raw, userPublicKey: keypair.publicKey });
  if (!built?.swapTransaction) throw new Error('jupiter: /swap returned no transaction');
  const signed = signSerializedTransaction(built.swapTransaction, keypair);
  const signature = await rpc.sendRawTransaction(signed.base64);
  await confirm(signature);
  return { signature, owner: keypair.publicKey };
}

/** Enough SOL left to pay for the exit? Never spend the fee buffer. */
export async function assertFeeBuffer(owner, spendSol = 0) {
  const balance = await rpc.solBalance(owner);
  if (balance - spendSol < cfg.SOL_FEE_BUFFER) {
    throw new Error(`SOL balance ${balance.toFixed(4)} would drop below the ${cfg.SOL_FEE_BUFFER} fee buffer`);
  }
  return balance;
}

/**
 * Buy `sizeUsd` of a token.
 * Returns the same shape in both modes: tokens held, the price we really paid
 * (size divided by tokens received, so slippage is baked in), and the fee.
 */
export async function buy(candidate, sizeUsd, deps = {}) {
  const quote = deps.quote || jup.quote;
  const solPriceUsd = deps.solPriceUsd || jup.solPriceUsd;

  const solPrice = await solPriceUsd();
  if (!(solPrice > 0)) throw new Error('could not price SOL');
  const lamportsIn = Math.floor((sizeUsd / solPrice) * 1e9);
  if (!(lamportsIn > 0)) throw new Error('position size rounds to zero SOL');

  const q = await quote({ inputMint: SOL_MINT, outputMint: candidate.mint, amount: lamportsIn });
  const decimals = num(candidate.decimals, 9);
  const feeUsd = networkFeeUsd(solPrice) + ATA_RENT_SOL * solPrice;

  if (cfg.MODE !== 'live') {
    const tokens = q.outAmount / 10 ** decimals;
    if (!(tokens > 0)) throw new Error('quote returned no tokens');
    return {
      mode: 'paper',
      tokens,
      rawTokens: q.outAmount,
      decimals,
      priceUsd: sizeUsd / tokens,
      solPrice,
      feeUsd,
      costUsd: round(sizeUsd + feeUsd, 4),
      priceImpactPct: q.priceImpactPct,
      signature: null,
    };
  }

  const keypair = loadKeypair();
  await assertFeeBuffer(keypair.publicKey, lamportsIn / 1e9);
  const before = await rpc.balanceOf(keypair.publicKey, candidate.mint);
  const { signature } = await swapLive(q);
  // Trust the chain, not the quote: read what actually landed.
  const after = await rpc.balanceOf(keypair.publicKey, candidate.mint);
  const rawTokens = Math.max(0, after.raw - before.raw);
  const realDecimals = after.decimals || decimals;
  const tokens = rawTokens / 10 ** realDecimals;
  if (!(tokens > 0)) throw new Error('buy confirmed but no tokens arrived');
  log.info(`live buy filled ${tokens} ${candidate.symbol}`, { signature });
  return {
    mode: 'live',
    tokens,
    rawTokens,
    decimals: realDecimals,
    priceUsd: sizeUsd / tokens,
    solPrice,
    feeUsd,
    costUsd: round(sizeUsd + feeUsd, 4),
    priceImpactPct: q.priceImpactPct,
    signature,
  };
}

/**
 * Sell a fraction of a position. A full exit sells the entire on-chain balance
 * — dust left behind is dust that costs another fee to clean up later.
 */
export async function sell(position, fraction, reason, deps = {}) {
  const quote = deps.quote || jup.quote;
  const solPriceUsd = deps.solPriceUsd || jup.solPriceUsd;

  const solPrice = await solPriceUsd();
  const full = fraction >= 0.999;
  let rawSell = Math.floor(num(position.rawTokens) * Math.min(1, fraction));

  let owner = null;
  if (cfg.MODE === 'live') {
    const keypair = loadKeypair();
    owner = keypair.publicKey;
    const onChain = await rpc.balanceOf(owner, position.mint);
    if (!(onChain.raw > 0)) throw new Error('nothing left on chain to sell');
    rawSell = full ? onChain.raw : Math.min(rawSell, onChain.raw);
  }
  if (!(rawSell > 0)) throw new Error('sell amount rounds to zero');

  const q = await quote({ inputMint: position.mint, outputMint: SOL_MINT, amount: rawSell });
  const decimals = num(position.decimals, 9);
  const tokensSold = rawSell / 10 ** decimals;
  const rentBack = full ? ATA_RENT_SOL * solPrice : 0;
  const feeUsd = networkFeeUsd(solPrice) - rentBack;

  if (cfg.MODE !== 'live') {
    const grossUsd = (q.outAmount / 1e9) * solPrice;
    return {
      mode: 'paper',
      reason,
      fraction,
      tokensSold,
      rawSold: rawSell,
      priceUsd: grossUsd / tokensSold,
      grossUsd: round(grossUsd, 4),
      feeUsd: round(feeUsd, 6),
      proceedsUsd: round(grossUsd - feeUsd, 4),
      priceImpactPct: q.priceImpactPct,
      signature: null,
    };
  }

  const solBefore = await rpc.solBalance(owner);
  const { signature } = await swapLive(q);
  const solAfter = await rpc.solBalance(owner);
  const grossUsd = Math.max(0, solAfter - solBefore) * solPrice;
  log.info(`live sell (${reason}) ${tokensSold} ${position.symbol}`, { signature });
  return {
    mode: 'live',
    reason,
    fraction,
    tokensSold,
    rawSold: rawSell,
    priceUsd: grossUsd / tokensSold,
    grossUsd: round(grossUsd, 4),
    feeUsd: 0, // already reflected in the SOL delta
    proceedsUsd: round(grossUsd, 4),
    priceImpactPct: q.priceImpactPct,
    signature,
  };
}
