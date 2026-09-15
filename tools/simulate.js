#!/usr/bin/env node
// npm run simulate — Monte Carlo over the real exit code, the real paths and
// the measured cost. Answers: how often does $50 reach the target, and how
// often does it go to zero first?
import { cfg } from '../src/config.js';
import { loadPaths } from '../src/paths.js';
import { replayAll, measureRoundTripCost } from '../src/replay.js';
import { simulate, breakEvenWinRate } from '../src/montecarlo.js';
import { usd } from '../src/util.js';

const paths = loadPaths({ minTicks: 3 });
const cost = measureRoundTripCost();
const replay = replayAll({ paths, costPct: cost.costPct });
if (replay.trades < 5) {
  console.log(`Only ${replay.trades} recorded paths. Simulating that would be making things up.`);
  process.exit(0);
}
const returns = replay.results.map((r) => r.returnPct);
const runs = Number(process.argv[2] || 5000);

console.log(`\nDrawing from ${replay.trades} real paths · ${cost.costPct}% round-trip cost · ${replay.avgPct}%/trade average\n`);
for (const target of [cfg.ROUND_TARGET_START_USD, cfg.ROUND_TARGET_START_USD + cfg.ROUND_TARGET_STEP_USD]) {
  const mc = simulate({ returns, runs, target });
  console.log(`${usd(cfg.BANKROLL_USD)} → ${usd(target)}`);
  console.log(`  wins the round   ${String(mc.winRate).padStart(5)}%`);
  console.log(`  goes to zero     ${String(mc.lossRate).padStart(5)}%`);
  console.log(`  still open at ${String(500).padStart(3)}  ${String(mc.timeoutRate).padStart(5)}%`);
  console.log(`  median trades    ${mc.medianTrades}\n`);
}
const breakEven = breakEvenWinRate(returns);
if (breakEven) console.log(`Break-even win rate at these sizes: ${breakEven}% (actual ${replay.winRate}%)\n`);
console.log('A simulation drawn from good weeks will describe good weeks. It is not a forecast.\n');
