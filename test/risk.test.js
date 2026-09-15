import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadState, checkRiskGate, applyClosedTrade } from '../src/money/bankroll.js';
import { tmpConfig, makeTrade } from './helpers.js';

test('risk gate blocks past max open positions', () => {
  const config = tmpConfig();
  const state = loadState(config);
  const gate = checkRiskGate(config, state, { mint: 'X', openPositionsCount: config.rules.maxOpenPositions });
  assert.equal(gate.allowed, false);
  assert.match(gate.reason, /max open positions/);
});

test('risk gate enforces cooldown after a loss', () => {
  const config = tmpConfig();
  let state = loadState(config);
  ({ state } = applyClosedTrade(config, state, makeTrade({ pnlUsd: -5, mint: 'A' })));
  const gate = checkRiskGate(config, state, { mint: 'B', openPositionsCount: 0 });
  assert.equal(gate.allowed, false);
  assert.match(gate.reason, /cooldown/);
});

test('risk gate blocks rebuying a token for 4h after a loss on it', () => {
  const config = tmpConfig();
  let state = loadState(config);
  ({ state } = applyClosedTrade(config, state, makeTrade({ pnlUsd: -5, mint: 'A' })));
  state.cooldownUntil = 0; // isolate the rebuy-block check from the cooldown check
  const gate = checkRiskGate(config, state, { mint: 'A', openPositionsCount: 0 });
  assert.equal(gate.allowed, false);
  assert.match(gate.reason, /rebuy blocked/);
});

test('risk gate blocks buying a token you already hold an open position in', () => {
  const config = tmpConfig();
  const state = loadState(config);
  const gate = checkRiskGate(config, state, { mint: 'A', openPositionsCount: 1, openMints: ['A'] });
  assert.equal(gate.allowed, false);
  assert.match(gate.reason, /already holding/);
});

test('risk gate allows a fresh token after loss elsewhere once cooldown clears', () => {
  const config = tmpConfig();
  let state = loadState(config);
  ({ state } = applyClosedTrade(config, state, makeTrade({ pnlUsd: -5, mint: 'A' })));
  state.cooldownUntil = 0;
  const gate = checkRiskGate(config, state, { mint: 'B', openPositionsCount: 0 });
  assert.equal(gate.allowed, true);
});

test('risk gate refuses to size a position below the minimum when bankroll is too small', () => {
  const config = tmpConfig({ bankrollUsd: 50 });
  const state = loadState(config);
  state.bankrollUsd = 2; // 16% of $2 is far below the $5 minimum, and $2 itself is below it too
  const gate = checkRiskGate(config, state, { mint: 'X', openPositionsCount: 0 });
  assert.equal(gate.allowed, false);
  assert.match(gate.reason, /insufficient bankroll/);
});
