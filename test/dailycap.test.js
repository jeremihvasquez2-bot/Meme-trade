import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadState, checkRiskGate, applyClosedTrade, dailyCapUsd } from '../src/money/bankroll.js';
import { tmpConfig, makeTrade } from './helpers.js';

test('daily cap is max($15, 30% of bankroll)', () => {
  const config = tmpConfig({ bankrollUsd: 50 });
  const state = loadState(config);
  assert.equal(dailyCapUsd(config, state), 15); // 30% of 50 = 15
  state.bankrollUsd = 200;
  assert.equal(dailyCapUsd(config, state), 60); // 30% of 200 = 60 > 15
});

test('risk gate blocks new trades once the daily loss cap is reached', () => {
  const config = tmpConfig({ bankrollUsd: 50 });
  let state = loadState(config);
  // Daily cap is $15; lose $16 across two trades on different mints to clear cooldown/rebuy noise.
  ({ state } = applyClosedTrade(config, state, makeTrade({ pnlUsd: -16, mint: 'A' })));
  state.cooldownUntil = 0;
  const gate = checkRiskGate(config, state, { mint: 'B', openPositionsCount: 0 });
  assert.equal(gate.allowed, false);
  assert.match(gate.reason, /daily loss cap/);
});

test('daily loss tally resets on a new UTC day', () => {
  const config = tmpConfig({ bankrollUsd: 50 });
  let state = loadState(config);
  ({ state } = applyClosedTrade(config, state, makeTrade({ pnlUsd: -16, mint: 'A' })));
  assert.ok(state.daily.lossUsd >= 16);
  state.daily.date = '2000-01-01'; // simulate yesterday
  state.cooldownUntil = 0;
  const gate = checkRiskGate(config, state, { mint: 'B', openPositionsCount: 0 });
  assert.equal(gate.allowed, true);
  assert.equal(state.daily.lossUsd, 0);
});
