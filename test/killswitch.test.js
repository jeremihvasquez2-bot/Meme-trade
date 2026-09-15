import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadState, applyClosedTrade } from '../src/money/bankroll.js';
import { tmpConfig, makeTrade } from './helpers.js';

test('live mode kill switch halts once realized loss reaches bankroll', () => {
  const config = tmpConfig({ mode: 'live', bankrollUsd: 50 });
  let state = loadState(config);

  let events;
  ({ state, events } = applyClosedTrade(config, state, makeTrade({ pnlUsd: -30, mint: 'A' })));
  assert.equal(state.halted, false);

  ({ state, events } = applyClosedTrade(config, state, makeTrade({ pnlUsd: -20, mint: 'B' })));
  assert.equal(state.halted, true);
  assert.equal(state.haltedReason.includes('kill switch'), true);
  assert.ok(events.some((e) => e.type === 'kill_switch'));
});

test('live mode does not halt while losses stay below bankroll', () => {
  const config = tmpConfig({ mode: 'live', bankrollUsd: 50 });
  let state = loadState(config);
  ({ state } = applyClosedTrade(config, state, makeTrade({ pnlUsd: -10, mint: 'A' })));
  assert.equal(state.halted, false);
});
