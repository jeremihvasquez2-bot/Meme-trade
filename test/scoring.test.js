import test from 'node:test';
import assert from 'node:assert/strict';
import './helper.js';
import { freshData, cleanup, candidate } from './helper.js';
import { cfg } from '../src/config.js';
import { scoreCandidate, shouldBuy, safetyScore, ageScore, buyPressureScore } from '../src/scoring.js';
import { HOUR } from '../src/util.js';

test.beforeEach(() => freshData());
test.after(cleanup);

test('every score stays inside 0 and 100', () => {
  const extremes = [
    candidate({ m5: 500, h1: 900, buysM5: 9999, sellsM5: 1, volumeH1: 9e9, rugcheckScore: 0, sellImpactPct: 0 }),
    candidate({ m5: -99, h1: -99, buysM5: 0, sellsM5: 500, volumeH1: 1, rugcheckScore: 5000, sellImpactPct: 50 }),
  ];
  for (const c of extremes) {
    const { total } = scoreCandidate(c);
    assert.ok(total >= 0 && total <= 100, `score out of range: ${total}`);
  }
});

test('a stronger candidate scores higher than a weak one', () => {
  const strong = scoreCandidate(candidate({ m5: 12, h1: 35, buysM5: 90, sellsM5: 20, volumeH1: 250_000 })).total;
  const weak = scoreCandidate(candidate({ m5: -3, h1: -5, buysM5: 13, sellsM5: 10, volumeH1: 22_000 })).total;
  assert.ok(strong > weak, `${strong} should beat ${weak}`);
});

test('smart money adds a boost only at two or more wallets', () => {
  const base = scoreCandidate(candidate()).total;
  assert.equal(scoreCandidate(candidate({ smartMoneyCount: 1 })).smartBoost, 0);
  const boosted = scoreCandidate(candidate({ smartMoneyCount: 2 }));
  assert.equal(boosted.smartBoost, cfg.SMART_MONEY_SCORE_BOOST);
  assert.ok(boosted.total > base);
});

test('the buy threshold is what decides a trade', () => {
  assert.equal(shouldBuy(cfg.SCORE_THRESHOLD), true);
  assert.equal(shouldBuy(cfg.SCORE_THRESHOLD - 0.01), false);
});

test('a worse RugCheck score lowers the safety component', () => {
  assert.ok(safetyScore(candidate({ rugcheckScore: 100 })) > safetyScore(candidate({ rugcheckScore: 1800 })));
});

test('a bigger sell impact lowers the safety component', () => {
  assert.ok(safetyScore(candidate({ sellImpactPct: 0.2 })) > safetyScore(candidate({ sellImpactPct: 7 })));
});

test('age scores best in the first few hours and decays after', () => {
  const young = ageScore(candidate({ createdAt: Date.now() - 0.5 * HOUR }));
  const sweet = ageScore(candidate({ createdAt: Date.now() - 6 * HOUR }));
  const old = ageScore(candidate({ createdAt: Date.now() - 60 * HOUR }));
  assert.ok(sweet > young);
  assert.ok(sweet > old);
});

test('buy pressure saturates rather than running away', () => {
  const high = buyPressureScore(candidate({ buysM5: 100, sellsM5: 1 }));
  const higher = buyPressureScore(candidate({ buysM5: 10_000, sellsM5: 1 }));
  assert.equal(high, higher);
});

test('the score parts add up to the total without the boost', () => {
  const scored = scoreCandidate(candidate());
  const sum = Object.values(scored.parts).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - scored.total) < 0.01);
});
