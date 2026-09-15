import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';

export function tmpConfig(overrides = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memebot-test-'));
  return loadConfig({ dataDir, bankrollUsd: 50, mode: 'paper', ...overrides });
}

export function makeTrade({ mint = 'MintA', pnlUsd, closedAt = Date.now(), openedAt = Date.now() - 60_000, outcome } = {}) {
  return {
    id: `${mint}-${closedAt}`,
    mint,
    symbol: mint,
    openedAt,
    closedAt,
    sizeUsd: 8,
    proceedsUsd: 8 + pnlUsd,
    pnlUsd,
    pnlPct: pnlUsd / 8,
    outcome: outcome || (pnlUsd >= 0 ? 'WIN' : 'LOSE'),
    exitReason: 'test',
    fills: [],
    source: 'scan',
  };
}
