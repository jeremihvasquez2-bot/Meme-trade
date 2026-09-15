import { loadConfig } from '../src/config.js';
import { effectiveRules } from '../src/proposals/proposals.js';
import { listPathIds, readPath } from '../src/learning/paths.js';
import { sweep } from '../src/learning/sweep.js';

const config = loadConfig({});
config.rules = effectiveRules(config);

const recordedPaths = listPathIds(config.dataDir).map((id) => readPath(config.dataDir, id));
if (!recordedPaths.length) {
  console.log('No recorded paths yet.');
  process.exit(0);
}

const results = sweep({
  recordedPaths,
  baseRules: config.rules,
  startingBankrollUsd: config.bankrollUsd,
  grid: {
    takeProfitMultiple: [2, 2.5, 3, 4],
    stopLossPct: [0.15, 0.2, 0.25, 0.3],
    trailingStopPct: [0.2, 0.3, 0.4],
  },
});

console.log(`Swept ${results.length} rule combinations over ${recordedPaths.length} recorded paths.\n`);
for (const r of results.slice(0, 15)) {
  const mc = r.monteCarlo ? ` · round win rate ${(r.monteCarlo.roundWinRate * 100).toFixed(0)}%` : '';
  console.log(
    `TP ${r.rules.takeProfitMultiple}x SL ${(r.rules.stopLossPct * 100).toFixed(0)}% TRAIL ${(r.rules.trailingStopPct * 100).toFixed(0)}%  ->  ${r.avgReturnPct.toFixed(2)}%/trade (n=${r.sampleSize})${mc}`,
  );
}
