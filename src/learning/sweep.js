import { replayAll } from './replay.js';
import { monteCarlo } from './simulate.js';

// Grid-searches exit parameters over the real recorded paths, then Monte
// Carlo's the bankroll trajectory for each candidate rule set. Returns
// results sorted best-avgReturnPct-first.
export function sweep({ recordedPaths, baseRules, grid, startingBankrollUsd }) {
  const combos = [];
  for (const takeProfitMultiple of grid.takeProfitMultiple) {
    for (const stopLossPct of grid.stopLossPct) {
      for (const trailingStopPct of grid.trailingStopPct) {
        combos.push({ takeProfitMultiple, stopLossPct, trailingStopPct });
      }
    }
  }

  const results = combos.map((combo) => {
    const rules = { ...baseRules, ...combo };
    const replay = replayAll(recordedPaths, rules);
    const returnMultiples = replay.results.map((r) => r.returnMultiple);
    const mc = returnMultiples.length
      ? monteCarlo({ returnMultiples, trials: 300, tradesPerTrial: 40, startingBankrollUsd, rules })
      : null;
    return { rules: combo, avgReturnPct: replay.avgReturnPct, sampleSize: replay.count, monteCarlo: mc };
  });

  return results.sort((a, b) => b.avgReturnPct - a.avgReturnPct);
}
