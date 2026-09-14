// Every notification carries the same money header and footer, so you never
// have to ask "yes but how much have I actually made".
import { cfg } from './config.js';
import { equity, openCost } from './state.js';
import { num, round, signedUsd, usd } from './util.js';

export function tally(state, openPositions = []) {
  const life = state.lifetime || {};
  const wallet = equity(state, openPositions);
  return {
    wallet,
    bankroll: num(state.bankrollStart, cfg.BANKROLL_USD),
    cash: round(num(state.cash), 2),
    inTrades: openCost(openPositions),
    open: openPositions.length,
    madeUsd: round(num(life.madeUsd), 2),
    lostUsd: round(num(life.lostUsd), 2),
    netUsd: round(num(life.netUsd), 2),
    feesUsd: round(num(life.feesUsd), 2),
    wins: num(life.wins),
    losses: num(life.losses),
    trades: num(life.trades),
    round: state.round?.n || 1,
    target: num(state.round?.target, cfg.ROUND_TARGET_START_USD),
    roundsWon: num(state.roundsWon),
    roundsLost: num(state.roundsLost),
  };
}

/** First line of every message: where the money is, right now. */
export function header(state, openPositions = []) {
  const t = tally(state, openPositions);
  const lines = [
    `💰 WALLET ${usd(t.wallet)} of ${usd(t.bankroll)} (${usd(t.inTrades)} in ${t.open} open trade${t.open === 1 ? '' : 's'})`,
  ];
  if (cfg.MODE !== 'live') {
    lines.push(`ROUND ${t.round} → target ${usd(t.target)} · ROUNDS WON ${t.roundsWon} – LOST ${t.roundsLost}`);
  } else {
    lines.push(`LIVE MODE · bankroll ${usd(t.bankroll)} · kill switch at ${usd(-t.bankroll)} realised`);
  }
  return lines.join('\n');
}

/** Last lines of every message: the lifetime score. */
export function footer(state, openPositions = []) {
  const t = tally(state, openPositions);
  return [
    `MADE ${usd(t.madeUsd)} · LOST ${usd(t.lostUsd)} · NET ${signedUsd(t.netUsd)}`,
    `RECORD: ${t.wins} WIN – ${t.losses} LOSE`,
  ].join('\n');
}

export function wrap(state, openPositions, body) {
  return [header(state, openPositions), '', body, '', footer(state, openPositions)].join('\n');
}
