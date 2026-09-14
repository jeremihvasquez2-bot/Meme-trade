import test from 'node:test';
import assert from 'node:assert/strict';
import './helper.js';
import { freshData, cleanup, candidate } from './helper.js';
import { cfg } from '../src/config.js';
import { freshState, blockMint } from '../src/state.js';
import { canOpen, riskSummary } from '../src/risk.js';
import { MINUTE } from '../src/util.js';

test.beforeEach(() => freshData());
test.after(cleanup);

const position = (over = {}) => ({ mint: 'Other', costUsd: 8, realisedUsd: 0, ...over });

test('a clean state opens at the right size', () => {
  const gate = canOpen(freshState(), candidate(), []);
  assert.equal(gate.ok, true);
  assert.equal(gate.sizeUsd, 8);
});

test('a halted bot never opens', () => {
  const state = freshState();
  state.halted = true;
  state.haltedReason = 'kill switch';
  const gate = canOpen(state, candidate(), []);
  assert.equal(gate.ok, false);
  assert.match(gate.reason, /halted/);
});

test('a paused bot never opens', () => {
  const state = freshState();
  state.paused = true;
  assert.equal(canOpen(state, candidate(), []).ok, false);
});

test('the max open positions limit is enforced', () => {
  const state = freshState();
  const open = Array.from({ length: cfg.MAX_OPEN_POSITIONS }, (_, i) => position({ mint: `M${i}` }));
  const gate = canOpen(state, candidate(), open);
  assert.equal(gate.ok, false);
  assert.match(gate.reason, /max/);
});

test('the cooldown after a loss blocks the next buy', () => {
  const now = Date.now();
  const state = freshState();
  state.lastLossAt = now - MINUTE;
  assert.equal(canOpen(state, candidate(), [], now).ok, false);
  assert.equal(canOpen(state, candidate(), [], now + cfg.COOLDOWN_AFTER_LOSS_MIN * MINUTE + 1).ok, true);
});

test('the daily loss cap stops the day', () => {
  const state = freshState();
  state.day.lossUsd = 15;
  const gate = canOpen(state, candidate(), []);
  assert.equal(gate.ok, false);
  assert.match(gate.reason, /daily loss cap/);
});

test('a token we just lost on is blocked for 4 hours', () => {
  const now = Date.now();
  const state = freshState();
  const c = candidate();
  blockMint(state, c.mint, now);
  assert.equal(canOpen(state, c, [], now + 60 * MINUTE).ok, false);
  assert.equal(canOpen(state, c, [], now + 5 * 60 * MINUTE).ok, true);
});

test('the Never buy list is honoured', () => {
  const state = freshState();
  const c = candidate();
  state.neverBuy = [c.mint];
  const gate = canOpen(state, c, []);
  assert.equal(gate.ok, false);
  assert.match(gate.reason, /Never buy/);
});

test('it will not double up on a token it already holds', () => {
  const state = freshState();
  const c = candidate();
  const gate = canOpen(state, c, [position({ mint: c.mint })]);
  assert.equal(gate.ok, false);
  assert.match(gate.reason, /already holding it/);
});

test('a bankroll too small for the minimum bet stops trading', () => {
  const state = freshState();
  state.cash = 2;
  const gate = canOpen(state, candidate(), []);
  assert.equal(gate.ok, false);
  assert.match(gate.reason, /too small/);
});

test('riskSummary reports what the gate is thinking', () => {
  const state = freshState();
  const summary = riskSummary(state, []);
  assert.equal(summary.equity, 50);
  assert.equal(summary.nextSize, 8);
  assert.equal(summary.dayCap, 15);
  assert.equal(summary.maxOpen, cfg.MAX_OPEN_POSITIONS);
});
