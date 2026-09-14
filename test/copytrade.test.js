import test from 'node:test';
import assert from 'node:assert/strict';
import './helper.js';
import { freshData, cleanup } from './helper.js';
import { roundTrips, gradeWallet, normaliseTrade, readBudget, budgetRemaining, monthKey } from '../src/sources/solanatracker.js';
import { saveWallets, loadWallets, smartMoneyMints, smartMoneyCount, holdersOf, followersLeft, followManually, discoveryTargets } from '../src/copytrade.js';
import { SOL_MINT, MINUTE, HOUR } from '../src/util.js';

test.beforeEach(() => freshData());
test.after(cleanup);

const TOKEN = 'Tok1111111111111111111111111111111111111111';
const buy = (t, volume = 100) => ({ time: t / 1000, from: { address: SOL_MINT, amount: 1 }, to: { address: TOKEN, amount: 1000 }, volume });
const sell = (t, volume = 150, amount = 1000) => ({ time: t / 1000, from: { address: TOKEN, amount }, to: { address: SOL_MINT, amount: 1.5 }, volume });

test('a trade is normalised whatever shape the API used', () => {
  const t = normaliseTrade({ time: 1700000000, from: { address: 'A', amount: 2 }, to: { address: 'B', amount: 3 }, volume: 50 });
  assert.equal(t.time, 1700000000000);
  assert.equal(t.fromMint, 'A');
  assert.equal(t.volumeUsd, 50);
});

test('round trips are reconstructed from a flat trade list', () => {
  const now = Date.now();
  const trips = roundTrips([buy(now - HOUR), sell(now)]);
  assert.equal(trips.length, 1);
  assert.equal(trips[0].holdMs, HOUR);
  assert.equal(trips[0].pnlUsd, 50);
});

test('a partial sale closes only the part that was sold', () => {
  const now = Date.now();
  const trips = roundTrips([buy(now - HOUR, 100), sell(now - 30 * MINUTE, 80, 500), sell(now, 90, 500)]);
  assert.equal(trips.length, 2);
  assert.equal(trips[0].costUsd, 50);
  assert.equal(trips[1].pnlUsd, 40);
});

test('a sale with nothing open is ignored rather than inventing a trade', () => {
  assert.equal(roundTrips([sell(Date.now())]).length, 0);
});

test('token-to-token swaps are not treated as cash round trips', () => {
  const other = 'Oth1111111111111111111111111111111111111111';
  const trips = roundTrips([{ time: Date.now() / 1000, from: { address: TOKEN, amount: 1 }, to: { address: other, amount: 1 }, volume: 10 }]);
  assert.equal(trips.length, 0);
});

const trips = (n, { win = true, holdMs = 30 * MINUTE } = {}) =>
  Array.from({ length: n }, () => ({ holdMs, pnlUsd: win ? 10 : -10, costUsd: 100, proceedsUsd: win ? 110 : 90 }));

test('a wallet with enough good round trips is followed', () => {
  const grade = gradeWallet('W', trips(20));
  assert.equal(grade.ok, true);
  assert.equal(grade.winRate, 1);
});

test('fewer than 15 round trips is not evidence', () => {
  const grade = gradeWallet('W', trips(9));
  assert.equal(grade.ok, false);
  assert.match(grade.reasons.join(' '), /only 9 round trips/);
});

test('a scalper bot holding for minutes is not followed', () => {
  const grade = gradeWallet('W', trips(30, { holdMs: 4 * MINUTE }));
  assert.equal(grade.ok, false);
  assert.match(grade.reasons.join(' '), /median hold/);
});

test('a wallet that loses more than half its trades is not followed', () => {
  const grade = gradeWallet('W', [...trips(10), ...trips(15, { win: false })]);
  assert.equal(grade.ok, false);
  assert.match(grade.reasons.join(' '), /win rate/);
});

test('the tracker request budget is per calendar month', () => {
  const budget = readBudget();
  assert.equal(budget.month, monthKey());
  assert.equal(budget.used, 0);
  assert.equal(budgetRemaining(), 2500);
});

test('discovery aims at the busiest liquid tokens, not everything', () => {
  const targets = discoveryTargets([
    { mint: 'A', liquidityUsd: 50_000, volumeH1: 10_000 },
    { mint: 'B', liquidityUsd: 50_000, volumeH1: 90_000 },
    { mint: 'C', liquidityUsd: 1_000, volumeH1: 900_000 },
  ]);
  assert.deepEqual(targets, ['B', 'A']);
});

test('a token two followed wallets hold jumps the queue', () => {
  saveWallets({
    wallets: [
      { owner: 'W1', following: true, holdings: { [TOKEN]: 10 } },
      { owner: 'W2', following: true, holdings: { [TOKEN]: 5, other: 1 } },
      { owner: 'W3', following: true, holdings: { somethingElse: 1 } },
    ],
    rejected: {},
    lastDiscoveryAt: 0,
  });
  assert.equal(smartMoneyCount(TOKEN), 2);
  assert.deepEqual(smartMoneyMints().map((s) => s.mint), [TOKEN]);
  assert.deepEqual(holdersOf(TOKEN).sort(), ['W1', 'W2']);
});

test('one wallet alone is not smart money', () => {
  saveWallets({ wallets: [{ owner: 'W1', following: true, holdings: { [TOKEN]: 10 } }], rejected: {}, lastDiscoveryAt: 0 });
  assert.deepEqual(smartMoneyMints(), []);
});

test('when the wallets that were holding walk away, so do we', () => {
  saveWallets({ wallets: [{ owner: 'W1', following: true, holdings: {} }, { owner: 'W2', following: true, holdings: {} }], rejected: {}, lastDiscoveryAt: 0 });
  assert.equal(followersLeft({ mint: TOKEN, followers: ['W1', 'W2'] }), true);
});

test('a position nobody followed us into is not judged on followers', () => {
  saveWallets({ wallets: [], rejected: {}, lastDiscoveryAt: 0 });
  assert.equal(followersLeft({ mint: TOKEN, followers: [] }), false);
});

test('a wallet can be followed by hand from the Control note', () => {
  followManually('WX');
  followManually('WX');
  const book = loadWallets();
  assert.equal(book.wallets.length, 1);
  assert.equal(book.wallets[0].manual, true);
});
