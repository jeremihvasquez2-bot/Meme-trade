#!/usr/bin/env node
// npm run entries — which entry features actually preceded the winners.
import { loadPaths } from '../src/paths.js';
import { replayAll, measureRoundTripCost } from '../src/replay.js';
import { num, round, median } from '../src/util.js';

const BUCKETS = {
  liquidityUsd: [15000, 30000, 60000, 120000, 250000],
  volumeH1: [20000, 50000, 120000, 300000],
  marketCap: [50000, 200000, 600000, 2000000],
  ageHours: [0.5, 2, 6, 24],
  buySellM5: [1.2, 1.5, 2, 3],
  m5: [-2, 0, 3, 8],
  rugcheckScore: [200, 600, 1200],
  sellImpactPct: [0.5, 1.5, 3, 5],
  smartMoneyCount: [1, 2, 3],
};

const paths = loadPaths({ minTicks: 3 });
if (!paths.length) {
  console.log('No recorded paths yet.');
  process.exit(0);
}
const cost = measureRoundTripCost();
const { results } = replayAll({ paths, costPct: cost.costPct });

function bucketLabel(edges, value) {
  if (!Number.isFinite(value)) return 'unknown';
  for (let i = 0; i < edges.length; i++) if (value < edges[i]) return i === 0 ? `<${edges[0]}` : `${edges[i - 1]}–${edges[i]}`;
  return `${edges.at(-1)}+`;
}

console.log(`\n${results.length} paths, ${cost.costPct}% round-trip cost. What came before the winners:\n`);
for (const [feature, edges] of Object.entries(BUCKETS)) {
  const groups = new Map();
  for (const r of results) {
    const value = num(r.features?.[feature], NaN);
    const key = bucketLabel(edges, value);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r.returnPct);
  }
  const rows = [...groups.entries()].filter(([, v]) => v.length >= 3);
  if (!rows.length) continue;
  console.log(feature);
  for (const [bucket, values] of rows) {
    const avg = round(values.reduce((a, b) => a + b, 0) / values.length, 2);
    const win = round((values.filter((v) => v > 0).length / values.length) * 100, 0);
    const bar = '█'.repeat(Math.max(0, Math.min(30, Math.round(avg / 2 + 10))));
    console.log(`  ${bucket.padEnd(16)} n=${String(values.length).padStart(4)}  avg ${String(avg).padStart(7)}%  win ${String(win).padStart(3)}%  median ${String(round(median(values), 1)).padStart(6)}%  ${bar}`);
  }
  console.log('');
}
console.log('n below ~30 in a bucket is a story, not a finding.\n');
