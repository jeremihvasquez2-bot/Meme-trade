import { Keypair, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { getQuote, buildSwapTransaction, SOL_MINT, usdToLamportsSol } from '../research/jupiter.js';
import { getConnection, getTokenBalance, getSolBalance } from '../research/rpc.js';

export function getKeypair(config) {
  if (!config.walletPrivateKey) throw new Error('WALLET_PRIVATE_KEY not set');
  return Keypair.fromSecretKey(bs58.decode(config.walletPrivateKey));
}

export function getWalletAddress(config) {
  return getKeypair(config).publicKey.toBase58();
}

async function signAndSend(config, swapTransaction) {
  const keypair = getKeypair(config);
  const conn = getConnection(config);
  const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
  tx.sign([keypair]);
  const signature = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  await conn.confirmTransaction(signature, 'confirmed');
  return signature;
}

export async function canAffordBuy(config, sizeUsd, solUsd) {
  const solBalance = await getSolBalance(config, getWalletAddress(config));
  const needed = sizeUsd / solUsd + config.rules.feeBufferSol;
  return solBalance >= needed;
}

// Executes a real on-chain buy. Returns the real post-fill token balance
// (never the quoted estimate) so accounting reflects what's actually held.
export async function buyLive(config, { mint, sizeUsd, solUsd, decimals }) {
  const keypair = getKeypair(config);
  const lamports = usdToLamportsSol(sizeUsd, solUsd);
  const quote = await getQuote({ inputMint: SOL_MINT, outputMint: mint, amount: lamports });
  const { swapTransaction } = await buildSwapTransaction({
    quoteResponse: quote,
    userPublicKey: keypair.publicKey.toBase58(),
    maxPriorityFeeLamports: config.rules.maxPriorityFeeLamports,
  });
  const signature = await signAndSend(config, swapTransaction);
  const tokenAmount = await getTokenBalance(config, keypair.publicKey.toBase58(), mint);
  const amountUsd = sizeUsd;
  return { signature, tokenAmount, priceUsd: amountUsd / tokenAmount, amountUsd, feeUsd: 0 };
}

// Sells; clamps to the real on-chain balance and sells the whole balance on a
// full exit so accounting can never drift from what's actually in the wallet.
export async function sellLive(config, { mint, tokenAmount, decimals, full, solUsd }) {
  const keypair = getKeypair(config);
  const owner = keypair.publicKey.toBase58();
  const onChainBalance = await getTokenBalance(config, owner, mint);
  const sellAmount = full ? onChainBalance : Math.min(tokenAmount, onChainBalance);
  const atoms = Math.floor(sellAmount * 10 ** decimals);
  if (atoms <= 0) return { signature: null, tokenAmount: 0, priceUsd: 0, amountUsd: 0, feeUsd: 0 };

  const quote = await getQuote({ inputMint: mint, outputMint: SOL_MINT, amount: atoms });
  const { swapTransaction } = await buildSwapTransaction({
    quoteResponse: quote,
    userPublicKey: owner,
    maxPriorityFeeLamports: config.rules.maxPriorityFeeLamports,
  });
  const signature = await signAndSend(config, swapTransaction);
  const solOut = Number(quote.outAmount) / 1e9;
  const amountUsd = solOut * solUsd;
  return { signature, tokenAmount: sellAmount, priceUsd: amountUsd / sellAmount, amountUsd, feeUsd: 0 };
}
