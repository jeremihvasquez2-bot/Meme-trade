// Scoring: five components, 0-100 total, buy at or above SCORE_THRESHOLD.
// Nothing here is clever — the point is that it is fixed, inspectable, and the
// replay tools can re-run it over recorded data when we want to change it.
import { cfg } from './config.js';
import { clamp, num, round, HOUR } from './util.js';
import { buySellRatioM5, turnover, ageMs } from './filters.js';

export const WEIGHTS = { momentum: 30, buyPressure: 25, turnover: 20, safety: 15, age: 10 };

function scale(value, lo, hi) {
  if (hi === lo) return 0;
  return clamp((value - lo) / (hi - lo), 0, 1);
}

export function momentumScore(c) {
  // Rising over 5 minutes AND over the hour. A 5m spike on an hour-long
  // downtrend is somebody else's exit liquidity.
  const m5 = clamp(num(c.m5), -20, 30);
  const h1 = clamp(num(c.h1), -40, 60);
  return round(WEIGHTS.momentum * (0.6 * scale(m5, -5, 20) + 0.4 * scale(h1, -10, 40)), 2);
}

export function buyPressureScore(c) {
  const ratio = Math.min(buySellRatioM5(c), 5);
  return round(WEIGHTS.buyPressure * scale(ratio, cfg.MIN_BUY_SELL_RATIO_M5, 3), 2);
}

export function turnoverScore(c) {
  // Hourly volume against liquidity: 1x is lively, 6x is a full-blown frenzy.
  return round(WEIGHTS.turnover * scale(turnover(c), 0.5, 6), 2);
}

export function safetyScore(c) {
  const rug = num(c.rugcheckScore, cfg.MAX_RUGCHECK_SCORE);
  const impact = num(c.sellImpactPct, cfg.MAX_PRICE_IMPACT_PCT);
  const rugPart = 1 - scale(rug, 0, cfg.MAX_RUGCHECK_SCORE);
  const impactPart = 1 - scale(impact, 0, cfg.MAX_PRICE_IMPACT_PCT);
  return round(WEIGHTS.safety * (0.6 * rugPart + 0.4 * impactPart), 2);
}

export function ageScore(c, now = Date.now()) {
  // The sweet spot is a few hours old: long enough to not be a launch snipe,
  // young enough that the move is not already over.
  const hours = ageMs(c, now) / HOUR;
  const peak = 6;
  const value = hours <= peak ? scale(hours, cfg.MIN_AGE_MINUTES / 60, peak) : 1 - scale(hours, peak, cfg.MAX_AGE_HOURS);
  return round(WEIGHTS.age * clamp(value, 0, 1), 2);
}

export function scoreCandidate(c, now = Date.now()) {
  const parts = {
    momentum: momentumScore(c),
    buyPressure: buyPressureScore(c),
    turnover: turnoverScore(c),
    safety: safetyScore(c),
    age: ageScore(c, now),
  };
  const base = Object.values(parts).reduce((a, b) => a + b, 0);
  const smart = num(c.smartMoneyCount) >= cfg.SMART_MONEY_MIN_WALLETS ? cfg.SMART_MONEY_SCORE_BOOST : 0;
  const total = clamp(round(base + smart, 2), 0, 100);
  return { total, parts, smartBoost: smart };
}

export function shouldBuy(score) {
  return num(score) >= cfg.SCORE_THRESHOLD;
}
