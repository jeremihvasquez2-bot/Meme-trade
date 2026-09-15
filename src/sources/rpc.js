// Thin Solana JSON-RPC client. Only the handful of methods the bot needs.
import { httpJson } from '../http.js';
import { cfg } from '../config.js';
import { num } from '../util.js';

let nextId = 1;

export async function rpc(method, params = [], { timeoutMs = 15000 } = {}) {
  const res = await httpJson(cfg.RPC_URL, {
    method: 'POST',
    timeoutMs,
    tries: 2,
    body: { jsonrpc: '2.0', id: nextId++, method, params },
  });
  if (res?.error) throw new Error(`rpc ${method}: ${res.error.message || JSON.stringify(res.error)}`);
  return res?.result;
}

/**
 * Mint authority and freeze authority must BOTH be revoked. If either is live
 * the owner can print supply or freeze your tokens mid-trade.
 */
export function readMintAuthorities(accountInfo) {
  const info = accountInfo?.value?.data?.parsed?.info;
  if (!info) return null;
  return {
    decimals: num(info.decimals, 9),
    supply: info.supply,
    mintAuthority: info.mintAuthority ?? null,
    freezeAuthority: info.freezeAuthority ?? null,
    mintRevoked: info.mintAuthority == null,
    freezeRevoked: info.freezeAuthority == null,
  };
}

export async function mintInfo(mint) {
  try {
    const value = await rpc('getAccountInfo', [mint, { encoding: 'jsonParsed' }]);
    return readMintAuthorities(value);
  } catch {
    return null;
  }
}

const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

export function parseTokenAccounts(result) {
  const out = [];
  for (const row of result?.value || []) {
    const info = row?.account?.data?.parsed?.info;
    const amount = info?.tokenAmount;
    if (!info?.mint || !amount) continue;
    out.push({
      mint: info.mint,
      raw: num(amount.amount),
      decimals: num(amount.decimals, 0),
      ui: num(amount.uiAmount),
    });
  }
  return out;
}

export async function tokenBalances(owner) {
  const all = [];
  for (const programId of [TOKEN_PROGRAM, TOKEN_2022_PROGRAM]) {
    try {
      const result = await rpc('getTokenAccountsByOwner', [owner, { programId }, { encoding: 'jsonParsed' }]);
      all.push(...parseTokenAccounts(result));
    } catch {
      // one program failing should not blind us to the other
    }
  }
  return all;
}

export async function balanceOf(owner, mint) {
  const rows = await tokenBalances(owner);
  const hits = rows.filter((r) => r.mint === mint);
  if (!hits.length) return { raw: 0, ui: 0, decimals: 0 };
  return hits.reduce((a, b) => ({ raw: a.raw + b.raw, ui: a.ui + b.ui, decimals: b.decimals }), {
    raw: 0,
    ui: 0,
    decimals: hits[0].decimals,
  });
}

export async function solBalance(owner) {
  const res = await rpc('getBalance', [owner]);
  return num(res?.value) / 1e9;
}

export async function sendRawTransaction(base64Tx) {
  return rpc('sendTransaction', [
    base64Tx,
    { encoding: 'base64', skipPreflight: true, maxRetries: 3, preflightCommitment: 'processed' },
  ]);
}

export async function signatureStatus(signature) {
  const res = await rpc('getSignatureStatuses', [[signature], { searchTransactionHistory: true }]);
  return res?.value?.[0] || null;
}
