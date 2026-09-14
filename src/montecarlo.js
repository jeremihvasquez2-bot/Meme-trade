// Monte Carlo over the measured per-trade returns. Answers the only question
// that matters for a small bankroll: how often does this go to zero before it
// goes to the target?
import { cfg } from './config.js';
import { clamp, num, round, median } from './util.js';

/** Deterministic PRNG so a reported simulation can be reproduced exactly. */
export function makeRng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

export function runRound({ returns, rng, bankroll = cfg.BANKROLL_USD, target = cfg.ROUND_TARGET_START_USD, maxTrades = 500 }) {
  let cash = bankroll;
  let trades = 0;
  while (trades < maxTrades) {
    const size = clamp(cfg.POSITION_PCT * cash, cfg.MIN_POSITION_USD, cfg.MAX_POSITION_USD);
    if (size > cash || cash < cfg.MIN_POSITION_USD) return { outcome: 'LOST', trades, endCash: round(cash, 2) };
    const r = returns[Math.floor(rng() * returns.length)];
    cash = round(cash + size * (num(r) / 100), 4);
    trades += 1;
    if (cash <= 0.01) return { outcome: 'LOST', trades, endCash: 0 };
    if (cash >= target) return { outcome: 'WON', trades, endCash: round(cash, 2) };
  }
  return { outcome: 'TIMEOUT', trades, endCash: round(cash, 2) };
}

export function simulate({ returns, runs = 2000, seed = 42, bankroll = cfg.BANKROLL_USD, target = cfg.ROUND_TARGET_START_USD } = {}) {
  if (!returns?.length) return { runs: 0, winRate: 0, lossRate: 0, medianTrades: 0, medianEnd: 0 };
  const rng = makeRng(seed);
  const outcomes = [];
  for (let i = 0; i < runs; i++) outcomes.push(runRound({ returns, rng, bankroll, target }));
  const won = outcomes.filter((o) => o.outcome === 'WON').length;
  const lost = outcomes.filter((o) => o.outcome === 'LOST').length;
  return {
    runs,
    bankroll,
    target,
    winRate: round((won / runs) * 100, 1),
    lossRate: round((lost / runs) * 100, 1),
    timeoutRate: round(((runs - won - lost) / runs) * 100, 1),
    medianTrades: round(median(outcomes.map((o) => o.trades)), 0),
    medianEnd: round(median(outcomes.map((o) => o.endCash)), 2),
  };
}

/** The break-even win rate implied by an average win and average loss. */
export function breakEvenWinRate(returns) {
  const wins = returns.filter((r) => r > 0);
  const losses = returns.filter((r) => r <= 0);
  if (!wins.length || !losses.length) return null;
  const avgWin = wins.reduce((a, b) => a + b, 0) / wins.length;
  const avgLoss = Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length);
  return round((avgLoss / (avgWin + avgLoss)) * 100, 1);
}
