import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldExitOnWalletDeparture } from '../src/copytrade/follow.js';

test('exits when most entry holders have left the token', () => {
  const snapshot = { A: ['OTHER'], B: ['OTHER'], C: ['MINT1'] };
  const result = shouldExitOnWalletDeparture('MINT1', ['A', 'B', 'C'], snapshot);
  assert.equal(result, true);
});

test('holds when most entry holders are still in the token', () => {
  const snapshot = { A: ['MINT1'], B: ['MINT1'], C: ['OTHER'] };
  const result = shouldExitOnWalletDeparture('MINT1', ['A', 'B', 'C'], snapshot);
  assert.equal(result, false);
});

test('no entry holders means nothing to base a departure exit on', () => {
  assert.equal(shouldExitOnWalletDeparture('MINT1', [], {}), false);
});
