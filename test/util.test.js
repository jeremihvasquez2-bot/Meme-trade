import test from 'node:test';
import assert from 'node:assert/strict';
import './helper.js';
import { cleanup } from './helper.js';
import { isoWeek, median, usd, signedUsd, humanDuration, clamp, safeDiv, dayKey, uniq, shortMint } from '../src/util.js';

test.after(cleanup);

test('isoWeek follows ISO-8601 week numbering', () => {
  assert.equal(isoWeek(Date.parse('2026-01-01T00:00:00Z')), '2026-W01');
  assert.equal(isoWeek(Date.parse('2026-09-14T00:00:00Z')), '2026-W38');
  assert.equal(isoWeek(Date.parse('2027-01-03T00:00:00Z')), '2026-W53');
});

test('median handles odd and even lengths and junk', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), 0);
  assert.equal(median([1, NaN, 3]), 2);
});

test('money formatting keeps cents on small amounts', () => {
  assert.equal(usd(8), '$8.00');
  assert.equal(usd(-12.345), '-$12.35');
  assert.equal(signedUsd(-3.2), '-$3.20');
  assert.equal(signedUsd(0), '+$0.00');
});

test('humanDuration reads like a person wrote it', () => {
  assert.equal(humanDuration(45_000), '45s');
  assert.equal(humanDuration(90_000), '1m');
  assert.equal(humanDuration(3_900_000), '1h 5m');
  assert.equal(humanDuration(3 * 86_400_000), '3d 0h');
});

test('clamp and safeDiv never blow up', () => {
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-1, 0, 3), 0);
  assert.equal(safeDiv(1, 0, -1), -1);
  assert.equal(safeDiv(10, 4), 2.5);
});

test('small helpers behave', () => {
  assert.equal(dayKey(Date.parse('2026-02-03T23:00:00Z')), '2026-02-03');
  assert.deepEqual(uniq([1, 1, 2]), [1, 2]);
  assert.equal(shortMint('So11111111111111111111111111111111111111112'), 'So11…1112');
});
