import { loadConfig } from '../src/config.js';
import { effectiveRules } from '../src/proposals/proposals.js';
import { loadState } from '../src/money/bankroll.js';
import { readTrades, summarize } from '../src/money/ledger.js';
import { checkReadiness } from '../src/money/readiness.js';
import { replayAll } from '../src/learning/replay.js';
import { listPathIds, readPath } from '../src/learning/paths.js';
import { generatePairCode } from '../src/telegram/pairing.js';
import { fmtUsd } from '../src/telegram/format.js';

const config = loadConfig({});
config.rules = effectiveRules(config);

const state = loadState(config);
const summary = summarize(readTrades(config.dataDir));
const recordedPaths = listPathIds(config.dataDir).map((id) => readPath(config.dataDir, id));
const replaySummary = recordedPaths.length ? replayAll(recordedPaths, config.rules) : null;
const readiness = checkReadiness({ summary, state, replaySummary });

console.log('=== MEMEBOT STATUS ===\n');
console.log(`Mode: ${config.mode}`);
console.log(
  state.mode === 'paper'
    ? `Bankroll: ${fmtUsd(state.bankrollUsd)} of ${fmtUsd(state.round.targetUsd)} target (round ${state.round.number})`
    : `Bankroll: ${fmtUsd(state.bankrollUsd)} · realized P&L ${fmtUsd(state.realizedPnlUsd)}`,
);
console.log(`Rounds: ${state.rounds.won} won – ${state.rounds.lost} lost`);
console.log(`Made / Lost / Net: ${fmtUsd(summary.made)} / ${fmtUsd(summary.lost)} / ${fmtUsd(summary.net)}`);
console.log(`Record: ${summary.wins} WIN – ${summary.losses} LOSE (${summary.closedCount} closed trades)`);
console.log(`Span: ${summary.spanDays.toFixed(1)} days across ${summary.activeDays} active days, ${summary.profitableWeeks} profitable weeks`);
console.log(`Halted: ${state.halted ? `yes (${state.haltedReason})` : 'no'} · Paused: ${state.paused ? 'yes' : 'no'}`);
console.log(`Replayed paths: ${replaySummary?.count ?? 0}${replaySummary ? `, avg return ${replaySummary.avgReturnPct.toFixed(1)}%/trade` : ''}`);

console.log(`\nREADINESS: ${readiness.go ? 'GO' : 'NOT YET'}`);
if (!readiness.go) {
  for (const item of readiness.unmet) console.log(`  - ${item}`);
}

if (config.telegramToken) {
  const code = generatePairCode(config.dataDir);
  console.log(`\nTelegram pairing code: ${code}`);
  console.log(`Send /start ${code} to your bot within 15 minutes.`);
} else {
  console.log('\nNo TELEGRAM_BOT_TOKEN set yet — run `node setup-from-phone.js` or `node set-key.js TELEGRAM_BOT_TOKEN <token>`.');
}
