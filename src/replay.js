// Replay: run the REAL exit code over the REAL recorded price paths. Not a
// model of the exit code — the same function main.js calls. If replay says a
// rule change helps, it helps on data that actually happened.
import { cfg } from './config.js';
import { decideExit } from './exits.js';
import { loadPaths } from './paths.js';
import { loadTrades } from './positions.js';
import { median, num, round } from './util.js';

// Measured on $8 round trips: buy impact + sell impact + two lots of fees.
export const DEFAULT_ROUND_TRIP_COST_PCT = 8.7;

/**
 * What a round trip really costs, measured from our own fills: how far the
 * price we got differed from the market mid, both ways, plus fees.
 */
export function measureRoundTripCost(trades = loadTrades()) {
  const samples = [];
  for (const t of trades) {
    const entryMid = num(t.features?.priceUsd);
    const entryEff = num(t.entryPriceUsd);
    const exitMid = num(t.exitMarketPriceUsd);
    const exitEff = num(t.exitPriceUsd);
    if (!(entryMid > 0 && entryEff > 0)) continue;
    let cost = (entryEff / entryMid - 1) * 100;
    if (exitMid > 0 && exitEff > 0) cost += (1 - exitEff / exitMid) * 100;
    cost += (num(t.feesUsd) / Math.max(1e-6, num(t.costUsd))) * 100;
    if (Number.isFinite(cost) && cost >= 0 && cost < 50) samples.push(cost);
  }
  if (samples.length < 5) return { costPct: DEFAULT_ROUND_TRIP_COST_PCT, samples: samples.length, measured: false };
  return { costPct: round(median(samples), 2), samples: samples.length, measured: true };
}

/** Walk one recorded path through the exit rules and report what we'd net. */
export function replayPath(path, rules = cfg, costPct = DEFAULT_ROUND_TRIP_COST_PCT) {
  const ticks = path.ticks || [];
  if (ticks.length < 2) return null;
  const entry = num(path.entryPriceUsd) || num(ticks[0].price);
  if (!(entry > 0)) return null;

  const position = {
    entryPriceUsd: entry,
    openedAt: ticks[0].t,
    peakPriceUsd: entry,
    strikes: 0,
    tookConviction: false,
  };
  let remaining = 1;
  let grossMultiple = 0;
  let reason = 'path_end';
  let closedAt = ticks[ticks.length - 1].t;

  for (const tick of ticks) {
    const price = num(tick.price);
    if (price > 0) {
      position.strikes = 0;
      position.peakPriceUsd = Math.max(position.peakPriceUsd, price);
    } else {
      position.strikes += 1;
    }
    const view = { priceUsd: price, m5: tick.m5, buysM5: tick.buys, sellsM5: tick.sells, volumeM5: tick.vol5m };
    const decision = decideExit(position, price > 0 ? view : null, tick.t, rules);
    if (decision.action !== 'sell') continue;

    const sold = remaining * decision.fraction;
    const fillPrice = price > 0 ? price : num(position.lastPrice, entry);
    grossMultiple += sold * (fillPrice / entry);
    remaining -= sold;
    if (decision.reason === 'take_profit_partial') position.tookConviction = true;
    if (remaining <= 1e-9) {
      reason = decision.reason;
      closedAt = tick.t;
      break;
    }
  }
  if (remaining > 1e-9) {
    const lastPrice = num(ticks[ticks.length - 1].price) || entry;
    grossMultiple += remaining * (lastPrice / entry);
  }

  const netMultiple = grossMultiple * (1 - costPct / 100);
  return {
    mint: path.mint,
    symbol: path.symbol,
    kind: path.kind,
    score: path.score,
    features: path.features,
    reason,
    holdMs: closedAt - ticks[0].t,
    grossPct: round((grossMultiple - 1) * 100, 2),
    returnPct: round((netMultiple - 1) * 100, 2),
    peakMultiple: round(position.peakPriceUsd / entry, 3),
  };
}

export function summarise(results) {
  const list = results.filter(Boolean);
  if (!list.length) {
    return { trades: 0, avgPct: 0, medianPct: 0, winRate: 0, totalPct: 0, best: 0, worst: 0, byReason: {} };
  }
  const returns = list.map((r) => r.returnPct);
  const wins = returns.filter((r) => r > 0).length;
  const byReason = {};
  for (const r of list) {
    byReason[r.reason] = byReason[r.reason] || { n: 0, avgPct: 0 };
    byReason[r.reason].n += 1;
    byReason[r.reason].avgPct += r.returnPct;
  }
  for (const v of Object.values(byReason)) v.avgPct = round(v.avgPct / v.n, 2);
  return {
    trades: list.length,
    avgPct: round(returns.reduce((a, b) => a + b, 0) / list.length, 2),
    medianPct: round(median(returns), 2),
    winRate: round((wins / list.length) * 100, 1),
    totalPct: round(returns.reduce((a, b) => a + b, 0), 2),
    best: round(Math.max(...returns), 2),
    worst: round(Math.min(...returns), 2),
    byReason,
  };
}

export function replayAll({ rules = cfg, paths = null, costPct = null } = {}) {
  const data = paths || loadPaths({ minTicks: 3 });
  const cost = costPct ?? measureRoundTripCost().costPct;
  const results = data.map((p) => replayPath(p, rules, cost)).filter(Boolean);
  return { ...summarise(results), costPct: cost, results };
}

export function defaultGrid() {
  return {
    TAKE_PROFIT_X: [1.8, 2.0, 2.5, 3.0, 4.0],
    STOP_LOSS_PCT: [0.15, 0.2, 0.25, 0.35],
    TRAILING_STOP_PCT: [0.2, 0.3, 0.4, 0.5],
  };
}

/** Cartesian product of a grid of rule values, each scored by replay. */
export function gridSearch({ paths = null, grid = defaultGrid(), costPct = null, base = cfg } = {}) {
  const data = paths || loadPaths({ minTicks: 3 });
  const cost = costPct ?? measureRoundTripCost().costPct;
  const keys = Object.keys(grid);
  const rows = [];
  const walk = (i, acc) => {
    if (i === keys.length) {
      const rules = { ...base, ...acc };
      const results = data.map((p) => replayPath(p, rules, cost)).filter(Boolean);
      rows.push({ rules: { ...acc }, ...summarise(results) });
      return;
    }
    for (const value of grid[keys[i]]) walk(i + 1, { ...acc, [keys[i]]: value });
  };
  walk(0, {});
  return rows.sort((a, b) => b.avgPct - a.avgPct);
}
