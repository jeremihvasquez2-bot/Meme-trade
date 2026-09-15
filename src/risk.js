// The gate every buy has to walk through. Nothing below this line is about
// finding winners — it is about making sure a bad run cannot become a bad day.
import { cfg } from './config.js';
import {
  dailyLossCap, equity, inCooldown, isBlocked, positionSize, rollDay,
} from './state.js';
import { num, humanDuration, MINUTE } from './util.js';

export function canOpen(state, candidate, openPositions = [], now = Date.now()) {
  rollDay(state, now);
  const deny = (reason) => ({ ok: false, reason, sizeUsd: 0 });

  if (state.halted) return deny(`halted: ${state.haltedReason || 'kill switch'}`);
  if (state.paused) return deny('paused by owner');
  if (openPositions.length >= cfg.MAX_OPEN_POSITIONS) {
    return deny(`already holding ${openPositions.length} positions (max ${cfg.MAX_OPEN_POSITIONS})`);
  }
  if (inCooldown(state, now)) {
    const left = cfg.COOLDOWN_AFTER_LOSS_MIN * MINUTE - (now - state.lastLossAt);
    return deny(`cooldown after a loss, ${humanDuration(left)} left`);
  }
  const cap = dailyLossCap(state, openPositions);
  if (num(state.day.lossUsd) >= cap) {
    return deny(`daily loss cap hit ($${state.day.lossUsd.toFixed(2)} of $${cap.toFixed(2)})`);
  }
  if (candidate?.mint && isBlocked(state, candidate.mint, now)) {
    return deny(`lost on this token within ${cfg.REBUY_BLOCK_HOURS}h`);
  }
  if (candidate?.mint && (state.neverBuy || []).includes(candidate.mint)) {
    return deny('on the Never buy list in Control.md');
  }
  if (openPositions.some((p) => p.mint === candidate?.mint)) return deny('already holding it');

  const sizeUsd = positionSize(state, openPositions);
  if (sizeUsd < cfg.MIN_POSITION_USD) {
    return deny(`bankroll $${equity(state, openPositions).toFixed(2)} too small for a $${cfg.MIN_POSITION_USD} bet`);
  }
  // Keep enough back to pay for the exit swap.
  if (num(state.cash) - sizeUsd < 0) return deny('not enough free cash');

  return { ok: true, reason: '', sizeUsd };
}

export function riskSummary(state, openPositions = [], now = Date.now()) {
  return {
    equity: equity(state, openPositions),
    cash: num(state.cash),
    open: openPositions.length,
    maxOpen: cfg.MAX_OPEN_POSITIONS,
    dayLoss: num(state.day?.lossUsd),
    dayCap: dailyLossCap(state, openPositions),
    cooldown: inCooldown(state, now),
    paused: !!state.paused,
    halted: !!state.halted,
    nextSize: positionSize(state, openPositions),
  };
}
