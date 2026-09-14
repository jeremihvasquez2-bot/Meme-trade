#!/usr/bin/env node
// npm run sweep — the grid, but judged on what actually matters for a small
// bankroll: how often the round is won, not the average return.
import { cfg } from '../src/config.js';
import { loadPaths } from '../src/paths.js';
import { replayPath, measureRoundTripCost, summarise, defaultGrid } from '../src/replay.js';
import { simulate } from '../src/montecarlo.js';

const paths = loadPaths({ minTicks: 3 });
const cost = measureRoundTripCost();
if (paths.length < 10) {
  console.log(`Only ${paths.length} recorded paths. A sweep over that would be noise.`);
  process.exit(0);
}

const grid = defaultGrid();
const runs = Number(process.argv[2] || 1500);
const rows = [];
const keys = Object.keys(grid);
const walk = (i, acc) => {
  if (i === keys.length) {
    const rules = { ...cfg, ...acc };
    const results = paths.map((p) => replayPath(p, rules, cost.costPct)).filter(Boolean);
    const stats = summarise(results);
    if (stats.trades < 5) return;
    const mc = simulate({ returns: results.map((r) => r.returnPct), runs, seed: 7 });
    rows.push({ ...acc, avgPct: stats.avgPct, winRate: stats.winRate, roundWin: mc.winRate, bust: mc.lossRate });
    return;
  }
  for (const value of grid[keys[i]]) walk(i + 1, { ...acc, [keys[i]]: value });
};
walk(0, {});
rows.sort((a, b) => b.roundWin - a.roundWin || b.avgPct - a.avgPct);

console.log(`\n${paths.length} paths · ${cost.costPct}% cost · ${runs} simulated rounds per rule set\n`);
console.log(`  ${'tp'.padStart(5)} ${'stop'.padStart(6)} ${'trail'.padStart(6)} ${'avg%'.padStart(8)} ${'win%'.padStart(6)} ${'round won%'.padStart(11)} ${'bust%'.padStart(7)}`);
for (const row of rows.slice(0, 15)) {
  const current = row.TAKE_PROFIT_X === cfg.TAKE_PROFIT_X && row.STOP_LOSS_PCT === cfg.STOP_LOSS_PCT && row.TRAILING_STOP_PCT === cfg.TRAILING_STOP_PCT ? ' ← current' : '';
  console.log(
    `  ${String(row.TAKE_PROFIT_X).padStart(5)} ${String(row.STOP_LOSS_PCT).padStart(6)} ${String(row.TRAILING_STOP_PCT).padStart(6)} ` +
      `${String(row.avgPct).padStart(8)} ${String(row.winRate).padStart(6)} ${String(row.roundWin).padStart(11)} ${String(row.bust).padStart(7)}${current}`,
  );
}
console.log('\nThe top row is the best fit to the past, which is exactly how overfitting looks. Prefer a change that is good across a whole neighbourhood of the grid.\n');
