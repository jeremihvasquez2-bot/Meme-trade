// Solana Tracker, used only for finding wallets worth following.
//
// Deliberately NOT the global leaderboards: those are dominated by scalper
// bots doing thousands of sub-minute round trips that we cannot copy. We ask
// instead "who made money on the tokens we are already looking at", then vet
// each wallet's own trade history.
import { httpJson } from '../http.js';
import { cfg } from '../config.js';
import { num, median, CASH_MINTS, MINUTE } from '../util.js';
import { readJson, writeJson, dataPath } from '../store.js';

const BASE = 'https://data.solanatracker.io';

function budgetFile() {
  return dataPath('tracker-budget.json');
}

export function monthKey(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 7);
}

export function readBudget() {
  const saved = readJson(budgetFile(), null);
  const month = monthKey();
  if (!saved || saved.month !== month) return { month, used: 0 };
  return saved;
}

export function budgetRemaining() {
  return Math.max(0, cfg.TRACKER_MONTHLY_BUDGET - readBudget().used);
}

function spend(n = 1) {
  const budget = readBudget();
  budget.used += n;
  writeJson(budgetFile(), budget);
  return budget;
}

async function call(pathname) {
  if (!cfg.SOLANA_TRACKER_KEY) throw new Error('SOLANA_TRACKER_KEY not set');
  if (budgetRemaining() <= 0) throw new Error('solana tracker monthly budget spent');
  spend(1);
  return httpJson(`${BASE}${pathname}`, {
    headers: { 'x-api-key': cfg.SOLANA_TRACKER_KEY },
    timeoutMs: 20000,
    tries: 2,
  });
}

export async function topTraders(mint) {
  const data = await call(`/top-traders/${mint}`);
  const rows = Array.isArray(data) ? data : data?.wallets || data?.data || [];
  return rows.map((r) => r?.wallet || r?.owner || r?.address).filter(Boolean);
}

export async function walletTrades(owner) {
  const data = await call(`/wallet/${owner}/trades`);
  return Array.isArray(data) ? data : data?.trades || [];
}

export function normaliseTrade(t) {
  const fromMint = t?.from?.address ?? t?.fromToken?.address ?? t?.tokenIn;
  const toMint = t?.to?.address ?? t?.toToken?.address ?? t?.tokenOut;
  const time = num(t?.time ?? t?.timestamp ?? t?.blockTime);
  return {
    time: time > 1e12 ? time : time * 1000,
    fromMint,
    toMint,
    fromAmount: num(t?.from?.amount ?? t?.fromAmount),
    toAmount: num(t?.to?.amount ?? t?.toAmount),
    volumeUsd: num(t?.volume ?? t?.volumeUsd ?? t?.from?.token?.usdPrice),
  };
}

/**
 * Rebuild round trips from a flat trade list. Cash (SOL/USDC/USDT) in means a
 * buy, cash out means a sell; a position closes when the whole token amount
 * bought has been sold back.
 */
export function roundTrips(trades) {
  const rows = trades.map(normaliseTrade).filter((t) => t.time && t.fromMint && t.toMint);
  rows.sort((a, b) => a.time - b.time);

  const open = new Map();
  const closed = [];
  for (const t of rows) {
    const buying = CASH_MINTS.has(t.fromMint) && !CASH_MINTS.has(t.toMint);
    const selling = CASH_MINTS.has(t.toMint) && !CASH_MINTS.has(t.fromMint);
    if (buying) {
      const prev = open.get(t.toMint) || { mint: t.toMint, openedAt: t.time, tokens: 0, costUsd: 0 };
      prev.tokens += t.toAmount;
      prev.costUsd += t.volumeUsd;
      open.set(t.toMint, prev);
    } else if (selling) {
      const prev = open.get(t.fromMint);
      if (!prev || prev.tokens <= 0) continue;
      const fraction = Math.min(1, t.fromAmount / prev.tokens);
      const cost = prev.costUsd * fraction;
      prev.tokens -= t.fromAmount;
      prev.costUsd -= cost;
      closed.push({
        mint: t.fromMint,
        openedAt: prev.openedAt,
        closedAt: t.time,
        holdMs: t.time - prev.openedAt,
        costUsd: cost,
        proceedsUsd: t.volumeUsd,
        pnlUsd: t.volumeUsd - cost,
      });
      if (prev.tokens <= 1e-9) open.delete(t.fromMint);
    }
  }
  return closed;
}

export function gradeWallet(owner, trips) {
  const count = trips.length;
  const wins = trips.filter((t) => t.pnlUsd > 0).length;
  const winRate = count ? wins / count : 0;
  const medianHoldMs = median(trips.map((t) => t.holdMs));
  const pnlUsd = trips.reduce((a, t) => a + t.pnlUsd, 0);
  const reasons = [];
  if (count < 15) reasons.push(`only ${count} round trips`);
  if (medianHoldMs < 20 * MINUTE) reasons.push(`median hold ${Math.round(medianHoldMs / MINUTE)}m < 20m`);
  if (winRate < 0.5) reasons.push(`win rate ${(winRate * 100).toFixed(0)}% < 50%`);
  return {
    owner,
    trips: count,
    wins,
    winRate,
    medianHoldMs,
    pnlUsd,
    ok: reasons.length === 0,
    reasons,
  };
}
