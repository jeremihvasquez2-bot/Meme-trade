#!/usr/bin/env node
// npm run status — the one screen that says whether this thing works yet.
import { cfg } from '../src/config.js';
import { loadState } from '../src/state.js';
import { loadPositions, loadTrades } from '../src/positions.js';
import { checks, render } from '../src/readiness.js';
import { header, footer, tally } from '../src/money.js';
import { riskSummary } from '../src/risk.js';
import { newPairingCode, isPaired, loadPairing } from '../src/telegram.js';
import { countPaths } from '../src/paths.js';
import { followed } from '../src/copytrade.js';
import { budgetRemaining } from '../src/sources/solanatracker.js';
import { humanDuration, usd, num } from '../src/util.js';

const state = loadState();
const positions = loadPositions();
const trades = loadTrades();
const t = tally(state, positions);
const risk = riskSummary(state, positions);

console.log('');
console.log(header(state, positions));
console.log('');
console.log(`MODE          ${cfg.MODE.toUpperCase()}${state.halted ? ' — HALTED: ' + state.haltedReason : state.paused ? ' — paused' : ''}`);
console.log(`OPEN          ${positions.length} of ${cfg.MAX_OPEN_POSITIONS}${positions.length ? ': ' + positions.map((p) => p.symbol).join(', ') : ''}`);
console.log(`NEXT BET      ${usd(risk.nextSize)}   (day loss ${usd(risk.dayLoss)} of ${usd(risk.dayCap)})`);
console.log(`LAST SCAN     ${state.lastScanAt ? humanDuration(Date.now() - state.lastScanAt) + ' ago' : 'never'}`);
console.log(`RECORDED      ${countPaths()} price paths · ${trades.length} closed trades`);
console.log(`WALLETS       following ${followed().length} · tracker budget ${budgetRemaining()} requests left this month`);
console.log(`DATA          ${cfg.DATA_DIR}`);
console.log(`BRAIN         ${cfg.BRAIN_DIR}`);
console.log('');
console.log(render(checks(state, { trades })));
console.log('');
console.log(footer(state, positions));
console.log('');

if (!isPaired()) {
  const pairing = newPairingCode();
  console.log('TELEGRAM      not paired yet.');
  console.log(`              Send your bot:   /start ${pairing.code}`);
  if (!cfg.TELEGRAM_BOT_TOKEN) console.log('              (and set the token first: node set-key.js TELEGRAM_BOT_TOKEN <token>)');
} else {
  console.log(`TELEGRAM      paired with chat ${loadPairing().chatId}`);
}
console.log('');
if (num(t.trades) === 0) console.log('No trades yet. Paper results are the ceiling, not the floor.');
