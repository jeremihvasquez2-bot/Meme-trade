import test from 'node:test';
import assert from 'node:assert/strict';
import './helper.js';
import { freshData, cleanup, setEnv } from './helper.js';
import { cfg } from '../src/config.js';
import { freshState, checkRound, shouldKill, halt } from '../src/state.js';

test.beforeEach(() => freshData());
test.after(cleanup);

test('a round is won at the target and the bar rises $100', () => {
  const state = freshState();
  state.cash = 210;
  const finished = checkRound(state, []);
  assert.equal(finished.outcome, 'WON');
  assert.equal(state.roundsWon, 1);
  assert.equal(state.round.n, 2);
  assert.equal(state.round.target, 300);
  assert.equal(state.cash, 50, 'a won round resets to a fresh bankroll');
});

test('a round is lost at zero and the bar stays where it was', () => {
  const state = freshState();
  state.cash = 0;
  const finished = checkRound(state, []);
  assert.equal(finished.outcome, 'LOST');
  assert.equal(state.roundsLost, 1);
  assert.equal(state.round.target, 200);
  assert.equal(state.cash, 50);
});

test('a round is not judged while trades are still open', () => {
  const state = freshState();
  state.cash = 0;
  assert.equal(checkRound(state, [{ costUsd: 8, realisedUsd: 0 }]), null);
  assert.equal(state.roundsLost, 0);
});

test('a round in progress changes nothing', () => {
  const state = freshState();
  state.cash = 60;
  assert.equal(checkRound(state, []), null);
  assert.equal(state.round.n, 1);
});

test('the day loss cap resets with a new round', () => {
  const state = freshState();
  state.cash = 250;
  state.day.lossUsd = 30;
  checkRound(state, []);
  assert.equal(state.day.lossUsd, 0);
});

test('paper mode never halts, however bad it gets', () => {
  const state = freshState();
  state.lifetime.netUsd = -500;
  assert.equal(shouldKill(state), false);
});

test('live mode halts once realised losses reach the bankroll', () => {
  setEnv({ MODE: 'live' });
  const state = freshState();
  state.lifetime.netUsd = -49.99;
  assert.equal(shouldKill(state), false);
  state.lifetime.netUsd = -50;
  assert.equal(shouldKill(state), true);
  setEnv({ MODE: 'paper' });
});

test('rounds do not run in live mode', () => {
  setEnv({ MODE: 'live' });
  const state = freshState();
  state.cash = 0;
  assert.equal(checkRound(state, []), null);
  setEnv({ MODE: 'paper' });
});

test('halting records the reason and stops a second kill', () => {
  setEnv({ MODE: 'live' });
  const state = freshState();
  state.lifetime.netUsd = -60;
  halt(state, 'kill switch');
  assert.equal(state.halted, true);
  assert.equal(state.haltedReason, 'kill switch');
  assert.equal(shouldKill(state), false);
  setEnv({ MODE: 'paper' });
});

test('the round target keeps climbing across several wins', () => {
  const state = freshState();
  for (const _ of [1, 2, 3]) {
    state.cash = state.round.target + 5;
    checkRound(state, []);
  }
  assert.equal(state.roundsWon, 3);
  assert.equal(state.round.target, 200 + 3 * cfg.ROUND_TARGET_STEP_USD);
});
