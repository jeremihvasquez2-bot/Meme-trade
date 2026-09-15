import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadState, applyClosedTrade } from '../src/money/bankroll.js';
import { tmpConfig, makeTrade } from './helpers.js';

test('paper round ends WON at target and resets bankroll, target rises', () => {
  const config = tmpConfig({ bankrollUsd: 50, rules: { roundStartTargetUsd: 200, roundTargetStepUsd: 100 } });
  let state = loadState(config);
  assert.equal(state.round.targetUsd, 200);

  const { state: s2, events } = applyClosedTrade(config, state, makeTrade({ pnlUsd: 200 }));
  state = s2;

  assert.equal(events[0].type, 'round_won');
  assert.equal(state.rounds.won, 1);
  assert.equal(state.bankrollUsd, 50); // reset to fresh bankroll
  assert.equal(state.round.number, 2);
  assert.equal(state.round.targetUsd, 300); // rose by step
});

test('paper round ends LOST at zero, target unchanged, scoreboard updates', () => {
  const config = tmpConfig({ bankrollUsd: 50, rules: { roundStartTargetUsd: 200, roundTargetStepUsd: 100 } });
  let state = loadState(config);

  const { state: s2, events } = applyClosedTrade(config, state, makeTrade({ pnlUsd: -50 }));
  state = s2;

  assert.equal(events[0].type, 'round_lost');
  assert.equal(state.rounds.lost, 1);
  assert.equal(state.bankrollUsd, 50);
  assert.equal(state.round.number, 2);
  assert.equal(state.round.targetUsd, 200); // unchanged on a loss
});

test('paper mode never halts even after many losing rounds', () => {
  const config = tmpConfig({ bankrollUsd: 50 });
  let state = loadState(config);
  for (let i = 0; i < 10; i++) {
    const r = applyClosedTrade(config, state, makeTrade({ pnlUsd: -50, mint: `M${i}` }));
    state = r.state;
  }
  assert.equal(state.halted, false);
  assert.equal(state.rounds.lost, 10);
});
