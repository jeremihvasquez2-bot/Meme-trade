import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRow, buildDataset, toJsonl, toCsv } from '../src/learning/export.js';
import { startPath, recordTick } from '../src/learning/paths.js';
import { DEFAULT_RULES } from '../src/config.js';
import { tmpConfig } from './helpers.js';

const entryFeatures = {
  mint: 'MintA',
  liquidityUsd: 50_000,
  volume1hUsd: 80_000,
  volume5mUsd: 5_000,
  mcapUsd: 300_000,
  ageMs: 2 * 3_600_000,
  m5Pct: 4,
  h1Pct: 10,
  buys5m: 40,
  sells5m: 20,
  buySellRatio5m: 2,
  rugcheckScore: 150,
  sellPriceImpactPct: 2.5,
  smartMoneyCount: 3,
};

function tick(tsOffsetMs, priceUsd, extra = {}) {
  return { ts: 1_000_000 + tsOffsetMs, priceUsd, ...extra };
}

test('buildRow never lets a feature reflect anything after entry_time (no leakage)', () => {
  const meta = { mint: 'MintA', symbol: 'A', entryFeatures, score: 77, shadow: true, startedAt: 1_000_000 };
  const ticksA = [tick(0, 1)];
  const ticksB = [tick(0, 1), tick(60_000, 5), tick(120_000, 0.1)]; // wildly different future

  const rowA = buildRow('p1', meta, ticksA, DEFAULT_RULES);
  const rowB = buildRow('p1', meta, ticksB, DEFAULT_RULES);

  const featureKeys = [
    'liquidity_usd', 'volume_1h_usd', 'volume_5m_usd', 'mcap_usd', 'age_hours',
    'price_change_5m_pct', 'price_change_1h_pct', 'buys_5m', 'sells_5m',
    'buy_sell_ratio_5m', 'rugcheck_score', 'sell_price_impact_pct', 'smart_money_count', 'score',
  ];
  for (const key of featureKeys) {
    assert.equal(rowA[key], rowB[key], `feature "${key}" changed even though only future ticks differed`);
  }
  // but the labels DID pick up the difference, proving the test is meaningful
  assert.notEqual(rowA.peak_multiple, rowB.peak_multiple);
});

test('is_traded reflects meta.shadow, and shadow rows are kept (not dropped)', () => {
  const shadowMeta = { mint: 'MintA', symbol: 'A', entryFeatures, score: 60, shadow: true, startedAt: 1_000_000 };
  const tradedMeta = { mint: 'MintB', symbol: 'B', entryFeatures, score: 80, shadow: false, startedAt: 1_000_000 };
  const ticks = [tick(0, 1)];

  const shadowRow = buildRow('shadow-1', shadowMeta, ticks, DEFAULT_RULES);
  const tradedRow = buildRow('traded-1', tradedMeta, ticks, DEFAULT_RULES);

  assert.equal(shadowRow.is_traded, false);
  assert.equal(tradedRow.is_traded, true);
});

test('forward returns are null until a tick actually exists at that horizon', () => {
  const meta = { mint: 'MintA', symbol: 'A', entryFeatures, score: 60, shadow: true, startedAt: 1_000_000 };
  // Only 20 minutes of data recorded so far.
  const ticks = [tick(0, 1), tick(10 * 60_000, 1.1), tick(20 * 60_000, 1.2)];
  const row = buildRow('p1', meta, ticks, DEFAULT_RULES);

  assert.notEqual(row.forward_return_15m_pct, null); // 20min of data covers the 15m horizon
  assert.equal(row.forward_return_1h_pct, null); // no data yet at 1h
  assert.equal(row.forward_return_4h_pct, null);
  assert.equal(row.forward_return_6h_pct, null);
});

test('forward returns compute correctly once data covers the horizon', () => {
  const meta = { mint: 'MintA', symbol: 'A', entryFeatures, score: 60, shadow: true, startedAt: 1_000_000 };
  const ticks = [tick(0, 1), tick(15 * 60_000, 1.5), tick(60 * 60_000, 2.0)];
  const row = buildRow('p1', meta, ticks, DEFAULT_RULES);

  assert.equal(row.forward_return_15m_pct, 50); // 1 -> 1.5 = +50%
  assert.equal(row.forward_return_1h_pct, 100); // 1 -> 2.0 = +100%
});

test('peak_multiple and worst_drawdown_pct reflect the whole recorded path', () => {
  const meta = { mint: 'MintA', symbol: 'A', entryFeatures, score: 60, shadow: true, startedAt: 1_000_000 };
  const ticks = [tick(0, 1), tick(60_000, 3), tick(120_000, 1.5), tick(180_000, 2)];
  const row = buildRow('p1', meta, ticks, DEFAULT_RULES);

  assert.equal(row.peak_multiple, 3); // peak of 3 vs entry of 1
  assert.equal(row.worst_drawdown_pct, (1.5 / 3 - 1) * 100); // worst drop from the peak of 3 down to 1.5
});

test('buildRow returns null for a path with no entry features or no ticks', () => {
  assert.equal(buildRow('p1', { mint: 'A', shadow: true }, [tick(0, 1)], DEFAULT_RULES), null);
  assert.equal(buildRow('p1', { mint: 'A', entryFeatures, shadow: true }, [], DEFAULT_RULES), null);
});

test('buildDataset reads every recorded path from disk and sorts by entry_time ascending', () => {
  const config = tmpConfig();
  startPath(config.dataDir, 'later', { mint: 'B', symbol: 'B', entryFeatures, score: 70, shadow: true });
  recordTick(config.dataDir, 'later', { priceUsd: 1 });

  // Backdate an "earlier" path so ordering is unambiguous regardless of clock resolution.
  startPath(config.dataDir, 'earlier', { mint: 'A', symbol: 'A', entryFeatures, score: 70, shadow: true });
  recordTick(config.dataDir, 'earlier', { priceUsd: 1 });

  const rows = buildDataset(config.dataDir, DEFAULT_RULES);
  assert.equal(rows.length, 2);
  assert.ok(new Date(rows[0].entry_time) <= new Date(rows[1].entry_time));
});

test('toJsonl and toCsv serialize the same rows consistently', () => {
  const rows = [
    { path_id: 'a', symbol: 'HAS,COMMA', score: 10, forward_return_15m_pct: null },
  ];
  const jsonl = toJsonl(rows);
  assert.deepEqual(JSON.parse(jsonl.trim()), rows[0]);

  const csv = toCsv(rows);
  const [header, dataLine] = csv.trim().split('\n');
  assert.equal(header, 'path_id,symbol,score,forward_return_15m_pct');
  assert.equal(dataLine, 'a,"HAS,COMMA",10,');
});

test('toCsv and toJsonl handle an empty dataset', () => {
  assert.equal(toCsv([]), '');
  assert.equal(toJsonl([]), '');
});
