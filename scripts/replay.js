import { loadConfig } from '../src/config.js';
import { effectiveRules } from '../src/proposals/proposals.js';
import { listPathIds, readPath } from '../src/learning/paths.js';
import { replayAll } from '../src/learning/replay.js';

const config = loadConfig({});
config.rules = effectiveRules(config);

const recordedPaths = listPathIds(config.dataDir).map((id) => readPath(config.dataDir, id));
if (!recordedPaths.length) {
  console.log('No recorded price paths yet. Let the bot run a while first.');
  process.exit(0);
}

console.log(`Replaying ${recordedPaths.length} recorded paths under the CURRENT rules...\n`);
const current = replayAll(recordedPaths, config.rules);
console.log(`current rules: avg return ${current.avgReturnPct.toFixed(2)}%/trade over ${current.count} paths\n`);

console.log('Grid over take-profit / stop-loss / trailing-stop variants:\n');
const grid = {
  takeProfitMultiple: [2, 2.5, 3, 4],
  stopLossPct: [0.15, 0.2, 0.25, 0.3],
  trailingStopPct: [0.2, 0.3, 0.4],
};

const rows = [];
for (const tp of grid.takeProfitMultiple) {
  for (const sl of grid.stopLossPct) {
    for (const ts of grid.trailingStopPct) {
      const rules = { ...config.rules, takeProfitMultiple: tp, stopLossPct: sl, trailingStopPct: ts };
      const result = replayAll(recordedPaths, rules);
      rows.push({ tp, sl, ts, avgReturnPct: result.avgReturnPct });
    }
  }
}
rows.sort((a, b) => b.avgReturnPct - a.avgReturnPct);
for (const r of rows.slice(0, 10)) {
  console.log(`TP ${r.tp}x  SL ${(r.sl * 100).toFixed(0)}%  TRAIL ${(r.ts * 100).toFixed(0)}%  ->  ${r.avgReturnPct.toFixed(2)}%/trade`);
}
