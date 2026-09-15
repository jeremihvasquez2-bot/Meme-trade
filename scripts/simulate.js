import { loadConfig } from '../src/config.js';
import { effectiveRules } from '../src/proposals/proposals.js';
import { listPathIds, readPath } from '../src/learning/paths.js';
import { replayAll } from '../src/learning/replay.js';
import { monteCarlo } from '../src/learning/simulate.js';

const config = loadConfig({});
config.rules = effectiveRules(config);

const recordedPaths = listPathIds(config.dataDir).map((id) => readPath(config.dataDir, id));
if (!recordedPaths.length) {
  console.log('No recorded paths yet — nothing to simulate from.');
  process.exit(0);
}

const replay = replayAll(recordedPaths, config.rules);
const returnMultiples = replay.results.map((r) => r.returnMultiple);
const result = monteCarlo({ returnMultiples, trials: 2000, tradesPerTrial: 50, startingBankrollUsd: config.bankrollUsd, rules: config.rules });

console.log(`Simulated ${result.trials} trials of ${result.tradesPerTrial} trades each, sampling from ${returnMultiples.length} real replayed outcomes.\n`);
console.log(`Avg rounds won per trial: ${result.avgRoundsWon.toFixed(2)}`);
console.log(`Avg rounds lost per trial: ${result.avgRoundsLost.toFixed(2)}`);
console.log(`Round win rate: ${(result.roundWinRate * 100).toFixed(1)}%`);
console.log(`Trials ending net positive (more rounds won than lost): ${(result.pctTrialsNetPositive * 100).toFixed(1)}%`);
