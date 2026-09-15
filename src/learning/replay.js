import { evaluateExit } from '../exits/rules.js';

// Re-runs the exit rules over one recorded real price path from a given entry
// index. `ticks` is the array recorded by learning/paths.js; `rulesOverride`
// lets scripts/replay.js grid-search targets/stops/trails without touching
// the live config.
export function replayPathFromEntry(ticks, entryIndex, rules) {
  if (entryIndex >= ticks.length) return null;
  const entry = ticks[entryIndex];
  const position = {
    entryPriceUsd: entry.priceUsd,
    peakPriceUsd: entry.priceUsd,
    openedAt: entry.ts,
    missedPriceStrikes: 0,
  };

  let remainingPortion = 1;
  let proceedsPortion = 0; // sum of (portion sold * price at sale / entryPrice), i.e. return multiple weighted by portion

  for (let i = entryIndex + 1; i < ticks.length; i++) {
    const tick = ticks[i];
    const market = {
      priceUsd: tick.priceUsd,
      missingPrice: tick.priceUsd === undefined || tick.priceUsd === null,
      buySellRatio5m: tick.buySell5m,
      m5Pct: tick.m5Pct,
      volume5mUsd: tick.volume5mUsd,
    };
    const decision = evaluateExit(position, market, rules, tick.ts);
    if (decision.action === 'none') continue;

    const soldPortion = remainingPortion * decision.portion;
    proceedsPortion += soldPortion * (tick.priceUsd / entry.priceUsd);
    remainingPortion -= soldPortion;

    if (decision.action === 'sell_all' || remainingPortion <= 0.0001) {
      return { exitReason: decision.reason, exitTs: tick.ts, returnMultiple: proceedsPortion };
    }
  }

  // Path ended before an exit rule fired: mark-to-last-price on whatever remains.
  const last = ticks[ticks.length - 1];
  proceedsPortion += remainingPortion * (last.priceUsd ?? entry.priceUsd) / entry.priceUsd;
  return { exitReason: 'path_ended', exitTs: last.ts, returnMultiple: proceedsPortion };
}

export function replayAll(recordedPaths, rules) {
  const results = recordedPaths.map(({ ticks }) => replayPathFromEntry(ticks, 0, rules)).filter(Boolean);
  const avgReturnPct = results.length
    ? (results.reduce((s, r) => s + (r.returnMultiple - 1), 0) / results.length) * 100
    : 0;
  return { count: results.length, avgReturnPct, results };
}
