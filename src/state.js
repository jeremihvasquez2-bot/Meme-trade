// The bankroll, the round scoreboard and the money tally. One file, written
// atomically, so `cat data/state.json` always tells you the whole truth about
// where the money is.
import { cfg } from './config.js';
import { dataPath, readJson, writeJson } from './store.js';
import { dayKey, isoWeek, num, round, HOUR, MINUTE } from './util.js';

export function stateFile() {
  return dataPath('state.json');
}

export function freshState(now = Date.now()) {
  return {
    createdAt: now,
    mode: cfg.MODE,
    cash: cfg.BANKROLL_USD,
    bankrollStart: cfg.BANKROLL_USD,
    round: { n: 1, target: cfg.ROUND_TARGET_START_USD, startedAt: now },
    roundsWon: 0,
    roundsLost: 0,
    lifetime: { madeUsd: 0, lostUsd: 0, netUsd: 0, feesUsd: 0, wins: 0, losses: 0, trades: 0 },
    day: { key: dayKey(now), lossUsd: 0 },
    weeks: {},
    blocked: {},
    lastLossAt: 0,
    paused: false,
    halted: false,
    haltedReason: '',
    haltedAt: 0,
    firstTradeAt: 0,
    lastScanAt: 0,
  };
}

export function loadState() {
  const saved = readJson(stateFile(), null);
  if (!saved) {
    const state = freshState();
    saveState(state);
    return state;
  }
  // Tolerate a state file written by an older build.
  return { ...freshState(saved.createdAt || Date.now()), ...saved };
}

export function saveState(state) {
  writeJson(stateFile(), state);
  return state;
}

/** Total book value: free cash plus what the open trades cost to open. */
export function equity(state, openPositions = []) {
  const open = openPositions.reduce((a, p) => a + num(p.costUsd) - num(p.realisedUsd), 0);
  return round(num(state.cash) + Math.max(0, open), 2);
}

export function openCost(openPositions = []) {
  return round(
    openPositions.reduce((a, p) => a + Math.max(0, num(p.costUsd) - num(p.realisedUsd)), 0),
    2,
  );
}

export function rollDay(state, now = Date.now()) {
  const key = dayKey(now);
  if (state.day?.key !== key) state.day = { key, lossUsd: 0 };
  return state;
}

/** The daily loss cap scales with the bankroll but never drops below $15. */
export function dailyLossCap(state, openPositions = []) {
  return Math.max(cfg.DAILY_LOSS_CAP_MIN_USD, cfg.DAILY_LOSS_CAP_PCT * equity(state, openPositions));
}

/** 16% of the CURRENT bankroll, so wins compound and losses shrink the bets. */
export function positionSize(state, openPositions = []) {
  const bankroll = equity(state, openPositions);
  const raw = cfg.POSITION_PCT * bankroll;
  const size = Math.min(cfg.MAX_POSITION_USD, Math.max(cfg.MIN_POSITION_USD, raw));
  return round(Math.min(size, num(state.cash)), 2);
}

export function blockMint(state, mint, now = Date.now()) {
  state.blocked = state.blocked || {};
  state.blocked[mint] = now + cfg.REBUY_BLOCK_HOURS * HOUR;
}

export function isBlocked(state, mint, now = Date.now()) {
  return num(state.blocked?.[mint]) > now;
}

export function pruneBlocked(state, now = Date.now()) {
  for (const [mint, until] of Object.entries(state.blocked || {})) {
    if (num(until) <= now) delete state.blocked[mint];
  }
}

export function inCooldown(state, now = Date.now()) {
  return num(state.lastLossAt) > 0 && now - state.lastLossAt < cfg.COOLDOWN_AFTER_LOSS_MIN * MINUTE;
}

/**
 * Fold a closed trade into the tallies. `pnlUsd` is the whole trade's result
 * after fees — partial sales are already summed by the caller.
 */
export function recordClosedTrade(state, trade, now = Date.now()) {
  rollDay(state, now);
  const pnl = round(num(trade.pnlUsd), 2);
  const life = state.lifetime;
  life.trades += 1;
  life.netUsd = round(life.netUsd + pnl, 2);
  life.feesUsd = round(life.feesUsd + num(trade.feesUsd), 2);
  if (pnl >= 0) {
    life.madeUsd = round(life.madeUsd + pnl, 2);
    life.wins += 1;
  } else {
    life.lostUsd = round(life.lostUsd + Math.abs(pnl), 2);
    life.losses += 1;
    state.day.lossUsd = round(state.day.lossUsd + Math.abs(pnl), 2);
    state.lastLossAt = now;
    blockMint(state, trade.mint, now);
  }
  const week = isoWeek(trade.closedAt || now);
  state.weeks[week] = round(num(state.weeks[week]) + pnl, 2);
  if (!state.firstTradeAt) state.firstTradeAt = trade.openedAt || now;
  return state;
}

/**
 * Rounds: paper mode never halts, it plays hands. A round ends at zero (LOST)
 * or at the target (WON); either way we reset to a fresh bankroll and the
 * scoreboard remembers. The target climbs $100 per win so the bot has to keep
 * getting better, not just get lucky once.
 */
export function checkRound(state, openPositions = [], now = Date.now()) {
  if (cfg.MODE === 'live') return null;
  if (openPositions.length) return null; // settle open trades before judging
  const value = equity(state, openPositions);
  const target = num(state.round.target, cfg.ROUND_TARGET_START_USD);
  let outcome = null;
  if (value >= target) outcome = 'WON';
  else if (value <= 0.01) outcome = 'LOST';
  if (!outcome) return null;

  const finished = {
    n: state.round.n,
    outcome,
    target,
    endedAt: now,
    startedAt: state.round.startedAt,
    endEquity: value,
  };
  if (outcome === 'WON') {
    state.roundsWon += 1;
    state.round = {
      n: state.round.n + 1,
      target: round(target + cfg.ROUND_TARGET_STEP_USD, 2),
      startedAt: now,
    };
  } else {
    state.roundsLost += 1;
    state.round = { n: state.round.n + 1, target, startedAt: now };
  }
  state.cash = cfg.BANKROLL_USD;
  state.bankrollStart = cfg.BANKROLL_USD;
  state.day = { key: dayKey(now), lossUsd: 0 };
  return finished;
}

/**
 * The kill switch. Live only: paper must keep running so we can keep learning
 * from the rounds it loses.
 */
export function shouldKill(state) {
  if (cfg.MODE !== 'live') return false;
  if (state.halted) return false;
  return num(state.lifetime.netUsd) <= -Math.abs(cfg.BANKROLL_USD);
}

export function halt(state, reason, now = Date.now()) {
  state.halted = true;
  state.haltedReason = reason;
  state.haltedAt = now;
  return state;
}
