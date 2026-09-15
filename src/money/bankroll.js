import path from 'node:path';
import { readJson, writeJson } from '../utils/store.js';
import { recordTrade } from './ledger.js';

function stateFile(dataDir) {
  return path.join(dataDir, 'state.json');
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

export function loadState(config) {
  const file = stateFile(config.dataDir);
  const fresh = {
    mode: config.mode,
    bankrollUsd: config.bankrollUsd,
    originalBankrollUsd: config.bankrollUsd,
    realizedPnlUsd: 0,
    round: {
      number: 1,
      targetUsd: config.rules.roundStartTargetUsd,
      startedAt: Date.now(),
    },
    rounds: { won: 0, lost: 0 },
    daily: { date: todayUtc(), lossUsd: 0 },
    cooldownUntil: 0,
    rebuyBlocks: {},
    halted: false,
    haltedReason: null,
    paused: false,
  };
  return readJson(file, fresh);
}

export function saveState(config, state) {
  writeJson(stateFile(config.dataDir), state);
}

function rolloverDailyIfNeeded(state) {
  const today = todayUtc();
  if (state.daily.date !== today) {
    state.daily = { date: today, lossUsd: 0 };
  }
}

export function dailyCapUsd(config, state) {
  const bankroll = state.mode === 'paper' ? state.bankrollUsd : state.originalBankrollUsd;
  return Math.max(config.rules.dailyCapMinUsd, config.rules.dailyCapPct * Math.max(bankroll, 0));
}

export function positionSizeUsd(config, state) {
  const bankroll = state.mode === 'paper' ? state.bankrollUsd : state.bankrollUsd;
  const raw = bankroll * config.rules.positionSizePct;
  const clamped = Math.min(Math.max(raw, config.rules.positionMinUsd), config.rules.positionMaxUsd);
  return Math.min(clamped, bankroll);
}

// Returns { allowed, reason, sizeUsd }
export function checkRiskGate(config, state, { mint, openPositionsCount, now = Date.now() }) {
  rolloverDailyIfNeeded(state);

  if (state.halted) return { allowed: false, reason: `halted: ${state.haltedReason}` };
  if (state.paused) return { allowed: false, reason: 'paused' };
  if (openPositionsCount >= config.rules.maxOpenPositions) {
    return { allowed: false, reason: 'max open positions reached' };
  }
  if (now < state.cooldownUntil) {
    return { allowed: false, reason: 'cooldown after loss' };
  }
  const rebuyUntil = state.rebuyBlocks[mint];
  if (rebuyUntil && now < rebuyUntil) {
    return { allowed: false, reason: 'rebuy blocked after recent loss on this token' };
  }
  const cap = dailyCapUsd(config, state);
  if (state.daily.lossUsd >= cap) {
    return { allowed: false, reason: 'daily loss cap reached' };
  }

  const sizeUsd = positionSizeUsd(config, state);
  if (sizeUsd < config.rules.positionMinUsd) {
    return { allowed: false, reason: 'insufficient bankroll for minimum position size' };
  }

  return { allowed: true, reason: null, sizeUsd };
}

// Applies a closed trade's realized P&L to bankroll/round/kill-switch state.
// Mutates and returns state; also appends to the trade ledger.
export function applyClosedTrade(config, state, trade) {
  rolloverDailyIfNeeded(state);

  state.realizedPnlUsd += trade.pnlUsd;

  if (trade.pnlUsd < 0) {
    state.daily.lossUsd += -trade.pnlUsd;
    state.cooldownUntil = Date.now() + config.rules.cooldownAfterLossMs;
    state.rebuyBlocks[trade.mint] = Date.now() + config.rules.rebuyBlockMs;
  }

  const events = [];

  if (state.mode === 'paper') {
    state.bankrollUsd += trade.pnlUsd;
    trade.round = state.round.number;

    if (state.bankrollUsd <= 0) {
      state.rounds.lost += 1;
      events.push({ type: 'round_lost', round: state.round.number, targetUsd: state.round.targetUsd });
      state.round = {
        number: state.round.number + 1,
        targetUsd: state.round.targetUsd,
        startedAt: Date.now(),
      };
      state.bankrollUsd = config.bankrollUsd;
    } else if (state.bankrollUsd >= state.round.targetUsd) {
      state.rounds.won += 1;
      events.push({ type: 'round_won', round: state.round.number, targetUsd: state.round.targetUsd });
      state.round = {
        number: state.round.number + 1,
        targetUsd: state.round.targetUsd + config.rules.roundTargetStepUsd,
        startedAt: Date.now(),
      };
      state.bankrollUsd = config.bankrollUsd;
    }
  } else {
    // live: bankroll is real cash on hand, tracked by the caller reading the
    // wallet after each fill; here we just track realized P&L for the kill switch.
    state.bankrollUsd += trade.pnlUsd;
    if (state.realizedPnlUsd <= -state.originalBankrollUsd) {
      state.halted = true;
      state.haltedReason = 'kill switch: realized loss reached bankroll';
      events.push({ type: 'kill_switch' });
    }
  }

  recordTrade(config.dataDir, trade);
  return { state, events };
}
