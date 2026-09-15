import test from 'node:test';
import assert from 'node:assert/strict';
import './helper.js';
import { freshData, cleanup, setEnv } from './helper.js';
import { header, footer, wrap, tally } from '../src/money.js';
import { freshState, recordClosedTrade } from '../src/state.js';

test.beforeEach(() => freshData());
test.after(cleanup);

function played() {
  const state = freshState();
  recordClosedTrade(state, { mint: 'M1', symbol: 'A', pnlUsd: 12, feesUsd: 0.4, closedAt: Date.now(), openedAt: Date.now() - 1000 });
  recordClosedTrade(state, { mint: 'M2', symbol: 'B', pnlUsd: -4, feesUsd: 0.4, closedAt: Date.now(), openedAt: Date.now() - 1000 });
  state.cash = 58;
  return state;
}

test('the tally adds up the way a person would add it up', () => {
  const t = tally(played(), [{ costUsd: 8, realisedUsd: 0 }]);
  assert.equal(t.madeUsd, 12);
  assert.equal(t.lostUsd, 4);
  assert.equal(t.netUsd, 8);
  assert.equal(t.wins, 1);
  assert.equal(t.losses, 1);
  assert.equal(t.inTrades, 8);
  assert.equal(t.wallet, 66);
});

test('every message starts with where the money is', () => {
  const text = header(played(), [{ costUsd: 8, realisedUsd: 0 }]);
  assert.match(text, /^💰 WALLET \$66\.00 of \$50\.00 \(\$8\.00 in 1 open trade\)/);
  assert.match(text, /ROUND 1 → target \$200\.00 · ROUNDS WON 0 – LOST 0/);
});

test('the header says "trades" when there is more than one', () => {
  const text = header(freshState(), [{ costUsd: 8, realisedUsd: 0 }, { costUsd: 8, realisedUsd: 0 }]);
  assert.match(text, /in 2 open trades/);
});

test('live mode shows the kill switch instead of the round', () => {
  setEnv({ MODE: 'live' });
  const text = header(freshState(), []);
  assert.match(text, /LIVE MODE/);
  assert.match(text, /kill switch at -\$50\.00/);
  setEnv({ MODE: 'paper' });
});

test('every message ends with the lifetime score', () => {
  const text = footer(played(), []);
  assert.equal(text, 'MADE $12.00 · LOST $4.00 · NET +$8.00\nRECORD: 1 WIN – 1 LOSE');
});

test('wrap puts the body between the header and the footer', () => {
  const text = wrap(freshState(), [], 'BODY');
  const lines = text.split('\n');
  assert.match(lines[0], /^💰 WALLET/);
  assert.ok(text.includes('\nBODY\n'));
  assert.match(lines.at(-1), /^RECORD:/);
});
