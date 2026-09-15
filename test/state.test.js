import test from 'node:test';
import assert from 'node:assert/strict';
import './helper.js';
import { freshData, cleanup, setEnv } from './helper.js';
import { cfg } from '../src/config.js';
import {
  freshState, loadState, saveState, equity, openCost, positionSize, dailyLossCap,
  recordClosedTrade, blockMint, isBlocked, pruneBlocked, inCooldown, rollDay,
} from '../src/state.js';
import { HOUR, MINUTE } from '../src/util.js';

test.beforeEach(() => freshData());
test.after(cleanup);

const trade = (over = {}) => ({ mint: 'M1', symbol: 'AAA', pnlUsd: 5, feesUsd: 0.2, closedAt: Date.now(), openedAt: Date.now() - HOUR, ...over });

test('a fresh state starts with the whole bankroll in cash', () => {
  const state = freshState();
  assert.equal(state.cash, 50);
  assert.equal(state.round.n, 1);
  assert.equal(state.round.target, 200);
  assert.equal(state.lifetime.netUsd, 0);
});

test('loadState persists and reloads', () => {
  const state = loadState();
  state.cash = 42;
  saveState(state);
  assert.equal(loadState().cash, 42);
});

test('equity is cash plus what the open trades still have at stake', () => {
  const state = freshState();
  state.cash = 34;
  const positions = [{ costUsd: 8, realisedUsd: 0 }, { costUsd: 8, realisedUsd: 4 }];
  assert.equal(openCost(positions), 12);
  assert.equal(equity(state, positions), 46);
});

test('position size is 16% of the current bankroll', () => {
  const state = freshState();
  assert.equal(positionSize(state), 8);
});

test('position size compounds as the bankroll grows', () => {
  const state = freshState();
  state.cash = 200;
  assert.equal(positionSize(state), 32);
});

test('position size never goes below the $5 minimum', () => {
  const state = freshState();
  state.cash = 20;
  assert.equal(positionSize(state), 5);
});

test('position size is capped at $250', () => {
  const state = freshState();
  state.cash = 10_000;
  assert.equal(positionSize(state), 250);
});

test('position size can never exceed the free cash', () => {
  const state = freshState();
  state.cash = 3;
  assert.equal(positionSize(state), 3);
});

test('the daily loss cap has a $15 floor', () => {
  const state = freshState();
  assert.equal(dailyLossCap(state), 15);
});

test('the daily loss cap is 30% once the bankroll is big enough', () => {
  const state = freshState();
  state.cash = 300;
  assert.equal(dailyLossCap(state), 90);
});

test('a winning trade adds to made, net and the week', () => {
  const state = freshState();
  recordClosedTrade(state, trade({ pnlUsd: 12.5 }));
  assert.equal(state.lifetime.madeUsd, 12.5);
  assert.equal(state.lifetime.netUsd, 12.5);
  assert.equal(state.lifetime.wins, 1);
  assert.equal(state.lifetime.losses, 0);
  assert.equal(Object.values(state.weeks)[0], 12.5);
});

test('a losing trade starts the cooldown, the day loss and the rebuy block', () => {
  const now = Date.now();
  const state = freshState();
  recordClosedTrade(state, trade({ pnlUsd: -4, mint: 'M9' }), now);
  assert.equal(state.lifetime.lostUsd, 4);
  assert.equal(state.day.lossUsd, 4);
  assert.ok(inCooldown(state, now + MINUTE));
  assert.ok(!inCooldown(state, now + (cfg.COOLDOWN_AFTER_LOSS_MIN + 1) * MINUTE));
  assert.ok(isBlocked(state, 'M9', now + HOUR));
  assert.ok(!isBlocked(state, 'M9', now + 5 * HOUR));
});

test('fees accumulate separately from P&L', () => {
  const state = freshState();
  recordClosedTrade(state, trade({ pnlUsd: 1, feesUsd: 0.4 }));
  recordClosedTrade(state, trade({ pnlUsd: -1, feesUsd: 0.4 }));
  assert.equal(state.lifetime.feesUsd, 0.8);
  assert.equal(state.lifetime.trades, 2);
});

test('expired rebuy blocks are pruned', () => {
  const now = Date.now();
  const state = freshState();
  blockMint(state, 'M1', now - 5 * HOUR);
  pruneBlocked(state, now);
  assert.equal(state.blocked.M1, undefined);
});

test('the day loss resets when the date changes', () => {
  const state = freshState();
  state.day = { key: '2000-01-01', lossUsd: 99 };
  rollDay(state);
  assert.equal(state.day.lossUsd, 0);
});

test('a larger bankroll from .env scales the first bet', () => {
  setEnv({ BANKROLL_USD: 500 });
  const state = freshState();
  assert.equal(positionSize(state), 80);
  setEnv({ BANKROLL_USD: 50 });
});
