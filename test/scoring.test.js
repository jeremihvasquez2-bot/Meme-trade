import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreCandidate } from '../src/research/scoring.js';
import { passesFilters } from '../src/research/filters.js';
import { DEFAULT_RULES } from '../src/config.js';

test('score is always within 0-100', () => {
  const best = scoreCandidate({ m5Pct: 50, h1Pct: 50, buySellRatio5m: 10, volume1hUsd: 1_000_000, mcapUsd: 100_000, rugcheckScore: 0, ageMs: 3 * 3_600_000 });
  const worst = scoreCandidate({ m5Pct: -50, h1Pct: -50, buySellRatio5m: 0, volume1hUsd: 0, mcapUsd: 100_000, rugcheckScore: 2000, ageMs: 0 });
  assert.ok(best.score <= 100 && best.score >= 0);
  assert.ok(worst.score <= 100 && worst.score >= 0);
  assert.ok(best.score > worst.score);
});

test('a strong candidate scores at or above the buy threshold', () => {
  const result = scoreCandidate({
    m5Pct: 15,
    h1Pct: 20,
    buySellRatio5m: 3,
    volume1hUsd: 200_000,
    mcapUsd: 500_000,
    rugcheckScore: 100,
    ageMs: 3 * 3_600_000,
  });
  assert.ok(result.score >= DEFAULT_RULES.scoreBuyThreshold, `expected >= ${DEFAULT_RULES.scoreBuyThreshold}, got ${result.score}`);
});

test('filters reject a candidate with unrevoked mint authority regardless of score', () => {
  const features = {
    liquidityUsd: 50_000,
    volume1hUsd: 50_000,
    ageMs: 3_600_000 * 2,
    mcapUsd: 200_000,
    buySellRatio5m: 2,
    mintAuthorityRevoked: false,
    freezeAuthorityRevoked: true,
    rugcheckScore: 100,
    sellPriceImpactPct: 1,
  };
  const { passed, reasons } = passesFilters(features, DEFAULT_RULES.filters);
  assert.equal(passed, false);
  assert.ok(reasons.some((r) => r.includes('authority')));
});

test('filters reject when no sell quote could be obtained (honeypot guard)', () => {
  const features = {
    liquidityUsd: 50_000,
    volume1hUsd: 50_000,
    ageMs: 3_600_000 * 2,
    mcapUsd: 200_000,
    buySellRatio5m: 2,
    mintAuthorityRevoked: true,
    freezeAuthorityRevoked: true,
    rugcheckScore: 100,
  };
  const { passed, reasons } = passesFilters(features, DEFAULT_RULES.filters);
  assert.equal(passed, false);
  assert.ok(reasons.some((r) => r.includes('sell quote')));
});

test('a fully clean candidate passes every filter', () => {
  const features = {
    liquidityUsd: 50_000,
    volume1hUsd: 50_000,
    ageMs: 3_600_000 * 2,
    mcapUsd: 200_000,
    buySellRatio5m: 2,
    mintAuthorityRevoked: true,
    freezeAuthorityRevoked: true,
    rugcheckScore: 100,
    rugcheckRisks: [],
    sellPriceImpactPct: 2,
  };
  const { passed } = passesFilters(features, DEFAULT_RULES.filters);
  assert.equal(passed, true);
});
