import path from 'node:path';
import { appendJsonl, readJsonl } from '../utils/store.js';

function tradesFile(dataDir) {
  return path.join(dataDir, 'trades.jsonl');
}

export function recordTrade(dataDir, trade) {
  appendJsonl(tradesFile(dataDir), trade);
}

export function readTrades(dataDir) {
  return readJsonl(tradesFile(dataDir));
}

export function isoWeek(ts) {
  const d = new Date(ts);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const week1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const weekNo = 1 + Math.round(((d - week1) / 86400000 - 3 + ((week1.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export function summarize(trades) {
  const closed = trades.filter((t) => t.closedAt);
  const made = closed.filter((t) => t.pnlUsd > 0).reduce((s, t) => s + t.pnlUsd, 0);
  const lost = closed.filter((t) => t.pnlUsd < 0).reduce((s, t) => s - t.pnlUsd, 0);
  const net = made - lost;
  const wins = closed.filter((t) => t.outcome === 'WIN').length;
  const losses = closed.filter((t) => t.outcome === 'LOSE').length;

  const weekly = new Map();
  for (const t of closed) {
    const wk = isoWeek(t.closedAt);
    weekly.set(wk, (weekly.get(wk) || 0) + t.pnlUsd);
  }
  const profitableWeeks = [...weekly.values()].filter((v) => v > 0).length;

  const days = new Set(closed.map((t) => new Date(t.closedAt).toISOString().slice(0, 10)));
  const firstClose = closed.length ? Math.min(...closed.map((t) => t.closedAt)) : null;
  const lastClose = closed.length ? Math.max(...closed.map((t) => t.closedAt)) : null;
  const spanDays = firstClose ? (lastClose - firstClose) / 86400000 : 0;

  return {
    closedCount: closed.length,
    made,
    lost,
    net,
    wins,
    losses,
    winRate: closed.length ? wins / closed.length : 0,
    activeDays: days.size,
    spanDays,
    weekly: Object.fromEntries(weekly),
    profitableWeeks,
  };
}
