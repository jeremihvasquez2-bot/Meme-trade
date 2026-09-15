#!/usr/bin/env node
// npm run replay — re-run the exit rules over every recorded price path, then
// try a grid of alternatives. This is the evidence a proposal needs.
import { cfg } from '../src/config.js';
import { loadPaths } from '../src/paths.js';
import { replayAll, gridSearch, measureRoundTripCost, defaultGrid } from '../src/replay.js';

const paths = loadPaths({ minTicks: 3 });
if (!paths.length) {
  console.log('No recorded paths yet. Let it run — it records one tick every 15s for every candidate that passes safety.');
  process.exit(0);
}

const cost = measureRoundTripCost();
console.log(`\n${paths.length} recorded paths (${paths.filter((p) => p.kind === 'position').length} traded, ${paths.filter((p) => p.kind === 'shadow').length} shadow)`);
console.log(`Round-trip cost: ${cost.costPct}% ${cost.measured ? `(measured over ${cost.samples} real fills)` : '(estimate — not enough real fills yet)'}\n`);

const current = replayAll({ paths, costPct: cost.costPct });
console.log('CURRENT RULES');
console.log(`  take profit ${cfg.TAKE_PROFIT_X}x · stop ${(cfg.STOP_LOSS_PCT * 100).toFixed(0)}% · trail ${(cfg.TRAILING_STOP_PCT * 100).toFixed(0)}% · max hold ${cfg.MAX_HOLD_HOURS}h`);
console.log(`  ${current.avgPct}%/trade · median ${current.medianPct}% · ${current.winRate}% profitable · best ${current.best}% worst ${current.worst}%`);
console.log('  exits:');
for (const [reason, v] of Object.entries(current.byReason).sort((a, b) => b[1].n - a[1].n)) {
  console.log(`    ${reason.padEnd(20)} ${String(v.n).padStart(4)}  avg ${v.avgPct}%`);
}

console.log('\nGRID — top 12 by average return per trade');
const rows = gridSearch({ paths, costPct: cost.costPct, grid: defaultGrid() });
console.log(`  ${'tp'.padStart(5)} ${'stop'.padStart(6)} ${'trail'.padStart(6)} ${'avg%'.padStart(8)} ${'median%'.padStart(8)} ${'win%'.padStart(6)}`);
for (const row of rows.slice(0, 12)) {
  const mark = row.rules.TAKE_PROFIT_X === cfg.TAKE_PROFIT_X && row.rules.STOP_LOSS_PCT === cfg.STOP_LOSS_PCT && row.rules.TRAILING_STOP_PCT === cfg.TRAILING_STOP_PCT ? ' ← current' : '';
  console.log(
    `  ${String(row.rules.TAKE_PROFIT_X).padStart(5)} ${String(row.rules.STOP_LOSS_PCT).padStart(6)} ${String(row.rules.TRAILING_STOP_PCT).padStart(6)} ` +
      `${String(row.avgPct).padStart(8)} ${String(row.medianPct).padStart(8)} ${String(row.winRate).padStart(6)}${mark}`,
  );
}
const best = rows[0];
if (best && best.avgPct > current.avgPct + 1) {
  console.log('\nBetter on this data:');
  console.log(
    `  node propose.js "Retune exits" "replay over ${current.trades} paths: ${best.avgPct}%/trade vs ${current.avgPct}% now" ` +
      `TAKE_PROFIT_X=${best.rules.TAKE_PROFIT_X} STOP_LOSS_PCT=${best.rules.STOP_LOSS_PCT} TRAILING_STOP_PCT=${best.rules.TRAILING_STOP_PCT}`,
  );
  console.log('\nA grid this size will find something that looks better by luck alone. Wait for more paths than you think you need.');
}
console.log('');
