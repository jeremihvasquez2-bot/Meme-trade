import test from 'node:test';
import assert from 'node:assert/strict';
import './helper.js';
import { freshData, cleanup } from './helper.js';
import { simulate, makeRng, runRound, breakEvenWinRate } from '../src/montecarlo.js';

test.beforeEach(() => freshData());
test.after(cleanup);

test('the same seed gives the same simulation', () => {
  const returns = [120, -25, -25, 60, -25];
  const a = simulate({ returns, runs: 200, seed: 9 });
  const b = simulate({ returns, runs: 200, seed: 9 });
  assert.deepEqual(a, b);
});

test('a strategy that only wins reaches the target', () => {
  const result = simulate({ returns: [80], runs: 100, target: 200 });
  assert.equal(result.winRate, 100);
  assert.equal(result.lossRate, 0);
});

test('a strategy that only loses busts every time', () => {
  const result = simulate({ returns: [-100], runs: 100 });
  assert.equal(result.lossRate, 100);
});

test('a single round reports how many trades it took', () => {
  const round = runRound({ returns: [100], rng: makeRng(3), bankroll: 50, target: 200 });
  assert.equal(round.outcome, 'WON');
  assert.ok(round.trades > 5 && round.trades < 100);
});

test('the break-even win rate falls as the winners get bigger', () => {
  const tight = breakEvenWinRate([25, -25]);
  const fat = breakEvenWinRate([150, -25]);
  assert.equal(tight, 50);
  assert.ok(fat < 20);
});

test('break-even is undefined without both winners and losers', () => {
  assert.equal(breakEvenWinRate([10, 20]), null);
});

test('simulating nothing returns nothing rather than lying', () => {
  assert.equal(simulate({ returns: [] }).runs, 0);
});
