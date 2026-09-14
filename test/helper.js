// Every test runs against its own throwaway data directory, so nothing here
// can ever touch a real bankroll.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reload } from '../src/config.js';
import { HOUR } from '../src/util.js';

process.env.LOG_QUIET = '1';
process.env.LOG_LEVEL = 'error';

const created = [];

export function freshData(overrides = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'memebot-test-'));
  created.push(base);
  process.env.DATA_DIR = path.join(base, 'data');
  process.env.BRAIN_DIR = path.join(base, 'brain');
  fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
  for (const [key, value] of Object.entries(overrides)) process.env[key] = String(value);
  reload();
  return { base, data: process.env.DATA_DIR, brain: process.env.BRAIN_DIR };
}

export function setEnv(values) {
  for (const [key, value] of Object.entries(values)) process.env[key] = String(value);
  reload();
}

export function clearEnv(...keys) {
  for (const key of keys) delete process.env[key];
  reload();
}

export function cleanup() {
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

export function candidate(over = {}) {
  return {
    mint: 'Mint1111111111111111111111111111111111111111',
    symbol: 'TEST',
    name: 'Test Token',
    priceUsd: 0.001,
    liquidityUsd: 50_000,
    volumeH1: 60_000,
    volumeM5: 8_000,
    marketCap: 400_000,
    m5: 5,
    h1: 20,
    buysM5: 40,
    sellsM5: 20,
    createdAt: Date.now() - 3 * HOUR,
    decimals: 6,
    rugcheckScore: 300,
    sellImpactPct: 1.2,
    ...over,
  };
}

/** A fake Jupiter that prices a token at `priceUsd` with `impactPct` slippage. */
export function fakeJupiter({ solPrice = 200, priceUsd = 0.001, decimals = 6, buyImpact = 0.03, sellImpact = 0.03 } = {}) {
  return {
    solPriceUsd: async () => solPrice,
    quote: async ({ inputMint, amount }) => {
      const isBuy = inputMint === 'So11111111111111111111111111111111111111112';
      if (isBuy) {
        const usdIn = (amount / 1e9) * solPrice;
        const tokens = (usdIn / priceUsd) * (1 - buyImpact);
        return { outAmount: Math.floor(tokens * 10 ** decimals), priceImpactPct: buyImpact * 100 };
      }
      const tokens = amount / 10 ** decimals;
      const usdOut = tokens * priceUsd * (1 - sellImpact);
      return { outAmount: Math.floor((usdOut / solPrice) * 1e9), priceImpactPct: sellImpact * 100 };
    },
  };
}

export function ticks(prices, { start = Date.now() - prices.length * 15000, stepMs = 15000, m5 = 0, buys = 10, sells = 10, vol5m = 1000 } = {}) {
  return prices.map((price, i) => ({ t: start + i * stepMs, price, m5, buys, sells, vol5m }));
}
