import test from 'node:test';
import assert from 'node:assert/strict';
import './helper.js';
import { freshData, cleanup, candidate } from './helper.js';
import { marketFilters, authorityCheck, sellabilityCheck, buySellRatioM5, turnover } from '../src/filters.js';
import { readMintAuthorities } from '../src/sources/rpc.js';
import { judge } from '../src/sources/rugcheck.js';
import { HOUR, MINUTE } from '../src/util.js';

test.beforeEach(() => freshData());
test.after(cleanup);

const fails = (over) => marketFilters(candidate(over)).fails.join(' | ');

test('a healthy candidate passes every market filter', () => {
  const result = marketFilters(candidate());
  assert.equal(result.pass, true, result.fails.join('; '));
});

test('liquidity outside $15k–$500k is rejected', () => {
  assert.match(fails({ liquidityUsd: 9_000 }), /liquidity .* < /);
  assert.match(fails({ liquidityUsd: 900_000 }), /liquidity .* > /);
});

test('an hour of volume under $20k is rejected', () => {
  assert.match(fails({ volumeH1: 5_000 }), /1h volume/);
});

test('anything younger than 20 minutes or older than 72 hours is rejected', () => {
  assert.match(fails({ createdAt: Date.now() - 5 * MINUTE }), /age/);
  assert.match(fails({ createdAt: Date.now() - 100 * HOUR }), /age/);
});

test('market cap outside $50k–$5M is rejected', () => {
  assert.match(fails({ marketCap: 10_000 }), /mcap/);
  assert.match(fails({ marketCap: 9_000_000 }), /mcap/);
});

test('weak 5-minute buy pressure is rejected', () => {
  assert.match(fails({ buysM5: 10, sellsM5: 20 }), /buy\/sell/);
  assert.equal(marketFilters(candidate({ buysM5: 13, sellsM5: 10 })).pass, true);
});

test('a candidate with no price is rejected', () => {
  assert.match(fails({ priceUsd: 0 }), /no price/);
});

test('buy/sell ratio copes with zero sells', () => {
  assert.equal(buySellRatioM5({ buysM5: 5, sellsM5: 0 }), Number.POSITIVE_INFINITY);
  assert.equal(buySellRatioM5({ buysM5: 0, sellsM5: 0 }), 0);
  assert.equal(turnover(candidate()), 1.2);
});

test('a live mint authority is a hard no', () => {
  const info = readMintAuthorities({ value: { data: { parsed: { info: { decimals: 6, mintAuthority: 'Someone', freezeAuthority: null } } } } });
  const result = authorityCheck(info);
  assert.equal(result.pass, false);
  assert.match(result.fails.join(' '), /mint authority NOT revoked/);
});

test('a live freeze authority is a hard no', () => {
  const info = readMintAuthorities({ value: { data: { parsed: { info: { decimals: 6, mintAuthority: null, freezeAuthority: 'Someone' } } } } });
  assert.equal(authorityCheck(info).pass, false);
});

test('both authorities revoked passes', () => {
  const info = readMintAuthorities({ value: { data: { parsed: { info: { decimals: 9, mintAuthority: null, freezeAuthority: null } } } } });
  assert.equal(authorityCheck(info).pass, true);
  assert.equal(info.decimals, 9);
});

test('an unreadable mint account is a hard no', () => {
  assert.equal(authorityCheck(null).pass, false);
});

test('no sell route means honeypot', () => {
  const result = sellabilityCheck(null);
  assert.equal(result.pass, false);
  assert.match(result.fails[0], /honeypot/);
});

test('a sell quote over 8% price impact is rejected', () => {
  assert.equal(sellabilityCheck({ priceImpactPct: 12 }).pass, false);
  assert.equal(sellabilityCheck({ priceImpactPct: 2.4 }).pass, true);
});

test('RugCheck danger risks are rejected whatever the score', () => {
  const verdict = judge({ score_normalised: 10, risks: [{ name: 'Freeze Authority', level: 'danger' }] }, 2000);
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /danger/);
});

test('a RugCheck score over the cap is rejected, and a missing report too', () => {
  assert.equal(judge({ score_normalised: 2500, risks: [] }, 2000).ok, false);
  assert.equal(judge({ score_normalised: 400, risks: [{ name: 'Low liquidity', level: 'warn' }] }, 2000).ok, true);
  assert.equal(judge(null, 2000).ok, false);
});
