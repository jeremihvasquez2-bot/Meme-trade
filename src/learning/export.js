import { listPathIds, readPath } from './paths.js';
import { replayPathFromEntry } from './replay.js';

const HORIZONS_MS = { '15m': 15 * 60_000, '1h': 3_600_000, '4h': 4 * 3_600_000, '6h': 6 * 3_600_000 };

// First tick at or after targetTs with a real price. Ticks are already in
// chronological order (appended as recorded), so the first match is the
// earliest one — never an arbitrary point further in the future.
function priceAtOrAfter(ticks, targetTs) {
  for (const t of ticks) {
    if (t.ts >= targetTs && typeof t.priceUsd === 'number') return t.priceUsd;
  }
  return null;
}

function peakMultiple(ticks, entryPrice) {
  let peak = entryPrice;
  for (const t of ticks) {
    if (typeof t.priceUsd === 'number' && t.priceUsd > peak) peak = t.priceUsd;
  }
  return peak / entryPrice;
}

// Max peak-to-trough decline observed anywhere in the path, as a negative percent.
function worstDrawdownPct(ticks, entryPrice) {
  let peak = entryPrice;
  let worst = 0;
  for (const t of ticks) {
    if (typeof t.priceUsd !== 'number') continue;
    if (t.priceUsd > peak) peak = t.priceUsd;
    const drawdown = t.priceUsd / peak - 1;
    if (drawdown < worst) worst = drawdown;
  }
  return worst * 100;
}

// Builds one training row from a recorded path, or null if the path can't be
// used (no entry features recorded, or no valid entry price to anchor on).
//
// LEAKAGE GUARD: every feature column below is read only from
// `meta.entryFeatures` / `meta.score` — a snapshot frozen at the moment the
// path was created and never mutated afterward. Nothing here ever reads a
// feature out of `ticks`, so a feature column can never contain information
// observed after entry_time by construction, not just by convention.
export function buildRow(id, meta, ticks, rules) {
  if (!meta?.entryFeatures || !ticks?.length) return null;
  const entry = ticks[0];
  if (typeof entry.priceUsd !== 'number') return null;

  const entryPrice = entry.priceUsd;
  const entryTs = meta.startedAt ?? entry.ts;
  const f = meta.entryFeatures;

  const forwardReturns = {};
  for (const [label, ms] of Object.entries(HORIZONS_MS)) {
    const price = priceAtOrAfter(ticks, entryTs + ms);
    forwardReturns[`forward_return_${label}_pct`] = price === null ? null : (price / entryPrice - 1) * 100;
  }

  const replay = replayPathFromEntry(ticks, 0, rules);

  return {
    path_id: id,
    mint: meta.mint,
    symbol: meta.symbol,
    entry_time: new Date(entryTs).toISOString(),
    is_traded: meta.shadow === false,
    // --- entry-only features ---
    liquidity_usd: f.liquidityUsd ?? null,
    volume_1h_usd: f.volume1hUsd ?? null,
    volume_5m_usd: f.volume5mUsd ?? null,
    mcap_usd: f.mcapUsd ?? null,
    age_hours: f.ageMs != null ? f.ageMs / 3_600_000 : null,
    price_change_5m_pct: f.m5Pct ?? null,
    price_change_1h_pct: f.h1Pct ?? null,
    buys_5m: f.buys5m ?? null,
    sells_5m: f.sells5m ?? null,
    buy_sell_ratio_5m: f.buySellRatio5m ?? null,
    rugcheck_score: f.rugcheckScore ?? null,
    sell_price_impact_pct: f.sellPriceImpactPct ?? null,
    smart_money_count: f.smartMoneyCount ?? 0,
    score: meta.score ?? null,
    // --- labels (may reference anything after entry_time) ---
    forward_return_15m_pct: forwardReturns.forward_return_15m_pct,
    forward_return_1h_pct: forwardReturns.forward_return_1h_pct,
    forward_return_4h_pct: forwardReturns.forward_return_4h_pct,
    forward_return_6h_pct: forwardReturns.forward_return_6h_pct,
    peak_multiple: peakMultiple(ticks, entryPrice),
    worst_drawdown_pct: worstDrawdownPct(ticks, entryPrice),
    outcome_exit_reason: replay.exitReason,
    outcome_return_pct: (replay.returnMultiple - 1) * 100,
  };
}

// Rebuilds the whole dataset from scratch from every recorded path on disk.
// Sorted by entry_time ascending so a walk-forward split (train on earlier
// rows, test on later ones) is just "take a prefix / suffix" — never a
// random split, which would leak future rows into the training set.
export function buildDataset(dataDir, rules) {
  const rows = listPathIds(dataDir)
    .map((id) => {
      const { meta, ticks } = readPath(dataDir, id);
      return buildRow(id, meta, ticks, rules);
    })
    .filter(Boolean);
  rows.sort((a, b) => new Date(a.entry_time) - new Date(b.entry_time));
  return rows;
}

export function toJsonl(rows) {
  return rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows) {
  if (!rows.length) return '';
  const columns = Object.keys(rows[0]);
  const lines = rows.map((r) => columns.map((c) => csvEscape(r[c])).join(','));
  return [columns.join(','), ...lines].join('\n') + '\n';
}
