import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateExit } from '../src/exits/rules.js';
import { DEFAULT_RULES } from '../src/config.js';

function makePosition(entryPriceUsd = 1) {
  return {
    entryPriceUsd,
    peakPriceUsd: entryPriceUsd,
    openedAt: Date.now(),
    missedPriceStrikes: 0,
  };
}

test('holds when nothing has moved', () => {
  const pos = makePosition();
  const decision = evaluateExit(pos, { priceUsd: 1.01 }, DEFAULT_RULES);
  assert.equal(decision.action, 'none');
});

test('takes full profit at 2.5x when momentum is not strong', () => {
  const pos = makePosition();
  const decision = evaluateExit(pos, { priceUsd: 2.5, buySellRatio5m: 1, m5Pct: 1, volume5mUsd: 1000 }, DEFAULT_RULES);
  assert.equal(decision.action, 'sell_all');
  assert.equal(decision.reason, 'take_profit');
});

test('conviction hold: sells only 75% at 2.5x when 5-min momentum is still strong', () => {
  const pos = makePosition();
  const decision = evaluateExit(pos, { priceUsd: 2.5, buySellRatio5m: 2.5, m5Pct: 5, volume5mUsd: 8000 }, DEFAULT_RULES);
  assert.equal(decision.action, 'sell_partial');
  assert.equal(decision.portion, DEFAULT_RULES.partialTakeProfitPct);
});

test('stops out at -25% from entry', () => {
  const pos = makePosition();
  const decision = evaluateExit(pos, { priceUsd: 0.74 }, DEFAULT_RULES);
  assert.equal(decision.action, 'sell_all');
  assert.equal(decision.reason, 'stop_loss');
});

test('does not stop out just above -25%', () => {
  const pos = makePosition();
  const decision = evaluateExit(pos, { priceUsd: 0.76 }, DEFAULT_RULES);
  assert.equal(decision.action, 'none');
});

test('trailing stop fires 30% down from peak even while still above entry', () => {
  const pos = makePosition(1);
  evaluateExit(pos, { priceUsd: 2 }, DEFAULT_RULES); // sets peak to 2
  const decision = evaluateExit(pos, { priceUsd: 1.39 }, DEFAULT_RULES); // 30.5% down from peak, still > entry
  assert.equal(decision.action, 'sell_all');
  assert.equal(decision.reason, 'trailing_stop');
});

test('max hold forces an exit after the configured window', () => {
  const pos = makePosition();
  pos.openedAt = Date.now() - DEFAULT_RULES.maxHoldMs - 1000;
  const decision = evaluateExit(pos, { priceUsd: 1.05 }, DEFAULT_RULES);
  assert.equal(decision.action, 'sell_all');
  assert.equal(decision.reason, 'max_hold');
});

test('a missing price is a strike, not an immediate exit', () => {
  const pos = makePosition();
  const decision = evaluateExit(pos, { missingPrice: true }, DEFAULT_RULES);
  assert.equal(decision.action, 'none');
  assert.equal(pos.missedPriceStrikes, 1);
});

test('forces an exit after 5 consecutive missing-price strikes', () => {
  const pos = makePosition();
  let decision;
  for (let i = 0; i < DEFAULT_RULES.maxMissedPriceStrikes; i++) {
    decision = evaluateExit(pos, { missingPrice: true }, DEFAULT_RULES);
  }
  assert.equal(decision.action, 'sell_all');
  assert.equal(decision.reason, 'strikes');
  assert.equal(decision.forceOnChain, true);
});

test('a strike streak resets once a real price comes back', () => {
  const pos = makePosition();
  evaluateExit(pos, { missingPrice: true }, DEFAULT_RULES);
  evaluateExit(pos, { missingPrice: true }, DEFAULT_RULES);
  evaluateExit(pos, { priceUsd: 1.0 }, DEFAULT_RULES);
  assert.equal(pos.missedPriceStrikes, 0);
});
