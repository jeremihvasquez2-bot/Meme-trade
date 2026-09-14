import test from 'node:test';
import assert from 'node:assert/strict';
import './helper.js';
import { freshData, cleanup, candidate, fakeJupiter } from './helper.js';
import { buy, sell, networkFeeUsd, ATA_RENT_SOL, BASE_FEE_LAMPORTS, TYPICAL_PRIORITY_LAMPORTS } from '../src/exec.js';

test.beforeEach(() => freshData());
test.after(cleanup);

test('the network fee is a real fee, not a percentage', () => {
  const fee = networkFeeUsd(200);
  assert.equal(fee, ((BASE_FEE_LAMPORTS + TYPICAL_PRIORITY_LAMPORTS) / 1e9) * 200);
  assert.ok(fee < 0.05, 'a signature should not cost five cents');
});

test('a paper buy is filled at the price the real quote implies', async () => {
  const deps = fakeJupiter({ solPrice: 200, priceUsd: 0.001, buyImpact: 0 });
  const fill = await buy(candidate(), 8, deps);
  assert.equal(fill.mode, 'paper');
  assert.equal(fill.tokens, 8000);
  assert.ok(Math.abs(fill.priceUsd - 0.001) < 1e-9);
});

test('slippage on the way in raises the price we actually paid', async () => {
  const deps = fakeJupiter({ solPrice: 200, priceUsd: 0.001, buyImpact: 0.05 });
  const fill = await buy(candidate(), 8, deps);
  assert.ok(fill.priceUsd > 0.001, 'a 5% impact must show up as a worse entry price');
  assert.ok(Math.abs(fill.priceUsd - 0.001 / 0.95) < 1e-6);
});

test('the cost basis includes the fee and the token account rent', async () => {
  const deps = fakeJupiter({ solPrice: 200 });
  const fill = await buy(candidate(), 8, deps);
  const expected = 8 + networkFeeUsd(200) + ATA_RENT_SOL * 200;
  assert.ok(Math.abs(fill.costUsd - expected) < 0.0001);
  assert.ok(fill.costUsd > 8, 'a buy always costs more than the size');
});

test('a paper sell prices the exact bag through a real sell quote', async () => {
  const deps = fakeJupiter({ solPrice: 200, priceUsd: 0.002, sellImpact: 0 });
  const position = { mint: 'M', symbol: 'T', rawTokens: 8_000_000_000, decimals: 6 };
  const sale = await sell(position, 1, 'take_profit', deps);
  assert.equal(sale.tokensSold, 8000);
  assert.ok(Math.abs(sale.grossUsd - 16) < 0.01);
});

test('a full exit hands the token account rent back', async () => {
  const deps = fakeJupiter({ solPrice: 200, priceUsd: 0.001, sellImpact: 0 });
  const position = { mint: 'M', symbol: 'T', rawTokens: 8_000_000_000, decimals: 6 };
  const full = await sell(position, 1, 'stop_loss', deps);
  const partial = await sell(position, 0.5, 'take_profit_partial', deps);
  assert.ok(full.feeUsd < 0, 'the rent refund outweighs the fee on a full exit');
  assert.ok(partial.feeUsd > 0, 'a partial exit keeps the account open, so no refund');
});

test('a round trip on $8 really does cost about 8-9%', async () => {
  const deps = fakeJupiter({ solPrice: 200, priceUsd: 0.001, buyImpact: 0.04, sellImpact: 0.04 });
  const fill = await buy(candidate(), 8, deps);
  const sale = await sell({ mint: 'M', symbol: 'T', rawTokens: fill.rawTokens, decimals: 6 }, 1, 'take_profit', deps);
  // Against what the trade really cost us, rent included — not against the size.
  const costPct = (1 - sale.proceedsUsd / fill.costUsd) * 100;
  assert.ok(costPct > 7 && costPct < 10, `round-trip cost was ${costPct.toFixed(2)}%`);
});

test('a size that rounds to zero SOL is refused', async () => {
  const deps = fakeJupiter({ solPrice: 200 });
  await assert.rejects(() => buy(candidate(), 0, deps), /rounds to zero/);
});

test('selling nothing is refused', async () => {
  const deps = fakeJupiter();
  await assert.rejects(() => sell({ mint: 'M', rawTokens: 0, decimals: 6 }, 1, 'x', deps), /rounds to zero/);
});
