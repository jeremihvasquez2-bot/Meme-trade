import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadState, positionSizeUsd, applyClosedTrade } from '../src/money/bankroll.js';
import { tmpConfig, makeTrade } from './helpers.js';

test('position size is 16% of CURRENT bankroll, clamped to [min, max]', () => {
  const config = tmpConfig({ bankrollUsd: 100 });
  const state = loadState(config);
  assert.equal(positionSizeUsd(config, state), 16); // 16% of 100
});

test('position size compounds as bankroll grows', () => {
  const config = tmpConfig({ bankrollUsd: 50 });
  let state = loadState(config);
  const sizeBefore = positionSizeUsd(config, state);
  ({ state } = applyClosedTrade(config, state, makeTrade({ pnlUsd: 40, mint: 'A' })));
  const sizeAfter = positionSizeUsd(config, state);
  assert.ok(sizeAfter > sizeBefore, `expected ${sizeAfter} > ${sizeBefore}`);
});

test('position size respects the floor and ceiling', () => {
  const config = tmpConfig({ bankrollUsd: 5000 });
  const state = loadState(config);
  assert.equal(positionSizeUsd(config, state), config.rules.positionMaxUsd); // 16% of 5000 = 800, clamped to $250 max
  state.bankrollUsd = 10;
  assert.equal(positionSizeUsd(config, state), config.rules.positionMinUsd); // 16% of 10 = 1.6, clamped up to $5 min
});
