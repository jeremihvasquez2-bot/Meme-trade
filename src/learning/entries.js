// Buckets closed trades by an entry feature and reports the average outcome
// per bucket, so you can see e.g. "trades entered with buySellRatio5m > 3
// outperform the rest." `edges` are ascending upper bounds; the last bucket
// catches everything above the final edge.
export function bucketByFeature(records, featureKey, edges) {
  const buckets = edges.map((edge, i) => ({
    label: i === 0 ? `< ${edge}` : `${edges[i - 1]}-${edge}`,
    max: edge,
    trades: [],
  }));
  buckets.push({ label: `>= ${edges[edges.length - 1]}`, max: Infinity, trades: [] });

  for (const r of records) {
    const value = r.features?.[featureKey];
    if (value === undefined || value === null) continue;
    const bucket = buckets.find((b) => value < b.max);
    (bucket || buckets[buckets.length - 1]).trades.push(r);
  }

  return buckets.map((b) => ({
    label: b.label,
    count: b.trades.length,
    avgPnlPct: b.trades.length ? (b.trades.reduce((s, t) => s + t.outcomePnlPct, 0) / b.trades.length) * 100 : null,
    winRate: b.trades.length ? b.trades.filter((t) => t.outcomePnlPct > 0).length / b.trades.length : null,
  }));
}

export const DEFAULT_FEATURE_EDGES = {
  liquidityUsd: [20_000, 50_000, 100_000, 250_000],
  volume1hUsd: [30_000, 60_000, 150_000],
  mcapUsd: [100_000, 500_000, 1_500_000],
  buySellRatio5m: [1.5, 2, 3],
  rugcheckScore: [200, 500, 1000],
  ageMs: [3_600_000, 12 * 3_600_000, 36 * 3_600_000],
};

export function analyzeEntries(records, featureEdges = DEFAULT_FEATURE_EDGES) {
  const report = {};
  for (const [key, edges] of Object.entries(featureEdges)) {
    report[key] = bucketByFeature(records, key, edges);
  }
  return report;
}
