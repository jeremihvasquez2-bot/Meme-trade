// Pure-ish exit rule evaluation. Mutates position.peakPriceUsd / missedPriceStrikes
// (the caller owns persistence) and returns a decision:
//   { action: 'none' | 'sell_partial' | 'sell_all', portion, reason, forceOnChain? }
export function evaluateExit(position, market, rules, now = Date.now()) {
  if (market.missingPrice) {
    position.missedPriceStrikes = (position.missedPriceStrikes || 0) + 1;
    if (position.missedPriceStrikes >= rules.maxMissedPriceStrikes) {
      return { action: 'sell_all', portion: 1, reason: 'strikes', forceOnChain: true };
    }
    return { action: 'none', reason: 'missing_price_strike' };
  }
  position.missedPriceStrikes = 0;

  const price = market.priceUsd;
  if (price > position.peakPriceUsd) position.peakPriceUsd = price;

  const multiple = price / position.entryPriceUsd;
  const changeFromEntryPct = multiple - 1;
  const drawdownFromPeakPct = 1 - price / position.peakPriceUsd;

  if (multiple >= rules.takeProfitMultiple) {
    const strongMomentum =
      (market.buySellRatio5m ?? 0) >= 2 &&
      (market.m5Pct ?? 0) >= 3 &&
      (market.volume5mUsd ?? 0) >= 5000;
    if (strongMomentum) {
      return { action: 'sell_partial', portion: rules.partialTakeProfitPct, reason: 'take_profit_partial_conviction_hold' };
    }
    return { action: 'sell_all', portion: 1, reason: 'take_profit' };
  }

  if (changeFromEntryPct <= -rules.stopLossPct) {
    return { action: 'sell_all', portion: 1, reason: 'stop_loss' };
  }

  if (drawdownFromPeakPct >= rules.trailingStopPct) {
    return { action: 'sell_all', portion: 1, reason: 'trailing_stop' };
  }

  if (now - position.openedAt >= rules.maxHoldMs) {
    return { action: 'sell_all', portion: 1, reason: 'max_hold' };
  }

  return { action: 'none', reason: 'hold' };
}
