// Exit rules. Pure and side-effect free so `npm run replay` can run exactly
// this code over thousands of recorded price paths.
import { cfg } from './config.js';
import { num, HOUR } from './util.js';

/** Is the crowd still buying hard enough to justify letting a runner run? */
export function strongPressure(tick, rules = cfg) {
  if (!tick) return false;
  const buys = num(tick.buysM5);
  const sells = num(tick.sellsM5);
  const ratio = sells === 0 ? (buys > 0 ? Number.POSITIVE_INFINITY : 0) : buys / sells;
  return (
    ratio >= rules.CONVICTION_MIN_BUY_SELL &&
    num(tick.m5) >= rules.CONVICTION_MIN_M5_PCT &&
    num(tick.volumeM5) >= rules.CONVICTION_MIN_VOL_M5_USD
  );
}

const hold = (note) => ({ action: 'hold', fraction: 0, reason: note });
const sell = (fraction, reason) => ({ action: 'sell', fraction, reason });

/**
 * A missing price is a strike, not a rug. DexScreener drops out; tokens do not
 * vanish. After MAX_PRICE_STRIKES in a row we stop giving it the benefit of
 * the doubt and get out at whatever the chain will pay.
 */
export function decideExit(position, tick, now = Date.now(), rules = cfg) {
  const entry = num(position.entryPriceUsd);
  const age = now - num(position.openedAt);

  if (!tick || !(num(tick.priceUsd) > 0)) {
    const strikes = num(position.strikes);
    if (strikes >= rules.MAX_PRICE_STRIKES) return sell(1, 'no_price_bailout');
    return hold(`price missing (strike ${strikes}/${rules.MAX_PRICE_STRIKES})`);
  }

  const price = num(tick.priceUsd);
  const peak = Math.max(num(position.peakPriceUsd) || entry, price);
  const multiple = entry > 0 ? price / entry : 0;

  if (!position.tookConviction && multiple >= rules.TAKE_PROFIT_X) {
    if (strongPressure(tick, rules)) return sell(1 - rules.CONVICTION_KEEP_PCT, 'take_profit_partial');
    return sell(1, 'take_profit');
  }
  if (multiple <= 1 - rules.STOP_LOSS_PCT) return sell(1, 'stop_loss');
  if (peak > entry && price <= peak * (1 - rules.TRAILING_STOP_PCT)) return sell(1, 'trailing_stop');
  if (age >= rules.MAX_HOLD_HOURS * HOUR) return sell(1, 'max_hold');

  return hold(`holding at ${multiple.toFixed(2)}x`);
}

export const EXIT_REASONS = {
  take_profit: 'hit the take-profit target',
  take_profit_partial: 'took profit but left a runner — buy pressure was still strong',
  stop_loss: 'hit the stop loss',
  trailing_stop: 'gave back too much from the peak',
  max_hold: 'ran out of time',
  no_price_bailout: 'price feed went dark and stayed dark',
  manual: 'you told me to',
  kill_switch: 'kill switch — selling everything',
};
