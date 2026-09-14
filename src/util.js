export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
export const CASH_MINTS = new Set([SOL_MINT, USDC_MINT, USDT_MINT]);

export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

export function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function round(n, places = 2) {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

export function usd(n) {
  const v = num(n);
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  return `${sign}$${a < 10 ? a.toFixed(2) : a.toFixed(a < 1000 ? 2 : 0)}`;
}

export function signedUsd(n) {
  const v = num(n);
  return `${v >= 0 ? '+' : '-'}$${Math.abs(v).toFixed(2)}`;
}

export function pct(n, places = 1) {
  return `${num(n) >= 0 ? '+' : ''}${num(n).toFixed(places)}%`;
}

export function dayKey(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10);
}

/** ISO-8601 week key, e.g. 2026-W07. Weeks start Monday. */
export function isoWeek(ts = Date.now()) {
  const d = new Date(ts);
  const utc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const date = new Date(utc);
  const dayNum = (date.getUTCDay() + 6) % 7; // Mon = 0
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((date - firstThursday) / (7 * DAY));
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function humanDuration(ms) {
  const s = Math.max(0, Math.floor(num(ms) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function median(values) {
  const list = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!list.length) return 0;
  const mid = list.length >> 1;
  return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
}

export function uniq(list) {
  return [...new Set(list)];
}

export function id(prefix = 't') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function shortMint(mint) {
  const s = String(mint || '');
  return s.length > 12 ? `${s.slice(0, 4)}…${s.slice(-4)}` : s;
}

/** Retry with exponential backoff. Only worth it for network calls. */
export async function retry(fn, { tries = 3, baseMs = 300 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn(i);
    } catch (err) {
      lastErr = err;
      if (i < tries - 1) await sleep(baseMs * 2 ** i);
    }
  }
  throw lastErr;
}

export function safeDiv(a, b, fallback = 0) {
  const x = num(a);
  const y = num(b);
  return y === 0 ? fallback : x / y;
}
