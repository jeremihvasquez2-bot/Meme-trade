// The gate between paper and real money. Every line must be GO. The monthly
// profit target is deliberately NOT a gate — it is a hope, and hopes do not
// get to unlock a wallet.
import { cfg } from './config.js';
import { loadTrades } from './positions.js';
import { loadPaths } from './paths.js';
import { replayAll } from './replay.js';
import { num, round, DAY } from './util.js';

export function checks(state, { trades = null, paths = null, now = Date.now() } = {}) {
  const closed = trades || loadTrades();
  const recorded = paths || loadPaths({ minTicks: 3 });
  const replay = replayAll({ paths: recorded });

  const firstAt = state.firstTradeAt || closed[0]?.openedAt || state.createdAt || now;
  const days = round((now - firstAt) / DAY, 1);
  const net = round(closed.reduce((a, t) => a + num(t.pnlUsd), 0), 2);
  const profitableWeeks = Object.values(state.weeks || {}).filter((v) => num(v) > 0).length;

  const rows = [
    row('Closed trades', closed.length, cfg.READY_MIN_TRADES, `${closed.length} of ${cfg.READY_MIN_TRADES}`),
    row('Days running', days, cfg.READY_MIN_DAYS, `${days} of ${cfg.READY_MIN_DAYS}`),
    row('Net P&L after fees', net, cfg.READY_MIN_PNL_USD, `$${net.toFixed(2)} of $${cfg.READY_MIN_PNL_USD}`),
    row('Recorded price paths', replay.trades, cfg.READY_MIN_PATHS, `${replay.trades} of ${cfg.READY_MIN_PATHS}`),
    row(
      'Replay of current rules',
      replay.trades >= cfg.READY_MIN_PATHS ? replay.avgPct : -999,
      cfg.READY_MIN_REPLAY_PCT,
      `${replay.avgPct >= 0 ? '+' : ''}${replay.avgPct}%/trade of +${cfg.READY_MIN_REPLAY_PCT}% (cost ${replay.costPct}%)`,
    ),
    row('Rounds won', num(state.roundsWon), cfg.READY_MIN_ROUNDS_WON, `${num(state.roundsWon)} of ${cfg.READY_MIN_ROUNDS_WON}`),
    row(
      'More rounds won than lost',
      num(state.roundsWon) - num(state.roundsLost),
      1,
      `won ${num(state.roundsWon)} – lost ${num(state.roundsLost)}`,
    ),
    row('Profitable weeks', profitableWeeks, cfg.READY_MIN_PROFITABLE_WEEKS, `${profitableWeeks} of ${cfg.READY_MIN_PROFITABLE_WEEKS}`),
    { label: 'Not halted', ok: !state.halted, detail: state.halted ? state.haltedReason : 'running' },
  ];

  const go = rows.every((r) => r.ok);
  return {
    go,
    rows,
    replay,
    net,
    days,
    profitableWeeks,
    monthlyTargetUsd: cfg.MONTHLY_PROFIT_TARGET_USD,
    monthlyPaceUsd: days > 0 ? round((net / days) * 30, 2) : 0,
  };
}

function row(label, value, min, detail) {
  return { label, ok: num(value) >= min, value, min, detail };
}

export function render(result) {
  const lines = result.rows.map((r) => `${r.ok ? '✅' : '❌'} ${r.label.padEnd(26)} ${r.detail}`);
  lines.push('');
  lines.push(`READINESS: ${result.go ? 'GO' : 'NOT YET'}`);
  lines.push(
    `Monthly profit target $${result.monthlyTargetUsd} — current pace $${result.monthlyPaceUsd}/month (a line, not a gate)`,
  );
  return lines.join('\n');
}
