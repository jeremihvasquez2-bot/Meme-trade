import { Connection, PublicKey } from '@solana/web3.js';

let connection;
export function getConnection(config) {
  if (!connection) connection = new Connection(config.rpcUrl, 'confirmed');
  return connection;
}

// @solana/web3.js's Connection methods have no built-in timeout, and the
// free public RPC endpoint is known to occasionally hang instead of
// erroring. Without this, one stuck call could wedge the whole scan loop
// forever, since scan.js awaits these sequentially per candidate.
function withTimeout(promise, ms = 10_000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('RPC call timed out')), ms)),
  ]);
}

// Returns { mintAuthorityRevoked, freezeAuthorityRevoked, decimals } or null on failure.
export async function getMintAuthorities(config, mint) {
  try {
    const conn = getConnection(config);
    const info = await withTimeout(conn.getParsedAccountInfo(new PublicKey(mint)));
    const parsed = info?.value?.data?.parsed;
    if (!parsed || parsed.type !== 'mint') return null;
    return {
      mintAuthorityRevoked: parsed.info.mintAuthority === null,
      freezeAuthorityRevoked: parsed.info.freezeAuthority === null,
      decimals: parsed.info.decimals,
    };
  } catch {
    return null;
  }
}

export async function getTokenBalance(config, owner, mint) {
  try {
    const conn = getConnection(config);
    const accounts = await withTimeout(conn.getParsedTokenAccountsByOwner(new PublicKey(owner), { mint: new PublicKey(mint) }));
    let total = 0;
    for (const { account } of accounts.value) {
      total += account.data.parsed.info.tokenAmount.uiAmount || 0;
    }
    return total;
  } catch {
    return 0;
  }
}

export async function getSolBalance(config, owner) {
  try {
    const conn = getConnection(config);
    const lamports = await withTimeout(conn.getBalance(new PublicKey(owner)));
    return lamports / 1e9;
  } catch {
    return 0;
  }
}

// All SPL tokens currently held by a wallet with a non-zero balance.
export async function getWalletHoldings(config, owner) {
  try {
    const conn = getConnection(config);
    const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    const accounts = await withTimeout(conn.getParsedTokenAccountsByOwner(new PublicKey(owner), { programId: TOKEN_PROGRAM_ID }));
    return accounts.value
      .map(({ account }) => account.data.parsed.info)
      .filter((info) => (info.tokenAmount.uiAmount || 0) > 0)
      .map((info) => ({ mint: info.mint, amount: info.tokenAmount.uiAmount }));
  } catch {
    return [];
  }
}
