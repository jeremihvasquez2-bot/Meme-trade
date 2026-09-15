import { loadConfig } from '../src/config.js';
import { listPathIds, readPath } from '../src/learning/paths.js';
import { analyzeEntries } from '../src/learning/entries.js';

const config = loadConfig({});
const ids = listPathIds(config.dataDir);
if (!ids.length) {
  console.log('No recorded paths yet.');
  process.exit(0);
}

const records = ids
  .map((id) => readPath(config.dataDir, id))
  .filter((p) => p.meta.entryFeatures && p.ticks.length > 1)
  .map((p) => {
    const first = p.ticks[0];
    const last = p.ticks[p.ticks.length - 1];
    return { features: p.meta.entryFeatures, outcomePnlPct: (last.priceUsd ?? first.priceUsd) / first.priceUsd - 1 };
  });

if (!records.length) {
  console.log('No paths with entry features recorded yet.');
  process.exit(0);
}

const report = analyzeEntries(records);
for (const [feature, buckets] of Object.entries(report)) {
  console.log(`\n${feature}`);
  for (const b of buckets) {
    if (!b.count) continue;
    console.log(`  ${b.label.padEnd(14)} n=${String(b.count).padEnd(4)} avg ${b.avgPnlPct.toFixed(1)}%  win rate ${(b.winRate * 100).toFixed(0)}%`);
  }
}
