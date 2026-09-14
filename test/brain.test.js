import test from 'node:test';
import assert from 'node:assert/strict';
import './helper.js';
import fs from 'node:fs';
import path from 'node:path';
import { freshData, cleanup } from './helper.js';
import { parseControl, ensureBrain, readControl, untickProposal, writeHome, tokenNote, walletNote, lesson, writeRules, writeProposals, brainDir, CONTROL_TEMPLATE } from '../src/brain.js';
import { freshState } from '../src/state.js';

test.beforeEach(() => freshData());
test.after(cleanup);

const MINT = 'So11111111111111111111111111111111111111112';
const WALLET = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';

test('a ticked pause box pauses the bot', () => {
  assert.equal(parseControl('- [x] pause trading').pause, true);
  assert.equal(parseControl('- [X] pause trading').pause, true);
  assert.equal(parseControl('- [ ] pause trading').pause, false);
});

test('the Never buy list is read as mint addresses', () => {
  const control = parseControl(`## Never buy\n\n- ${MINT}\n- not-a-mint\n\n## Wallets to follow\n`);
  assert.deepEqual(control.neverBuy, [MINT]);
});

test('wallets to follow are read the same way', () => {
  const control = parseControl(`## Wallets to follow\n\n- ${WALLET}\n`);
  assert.deepEqual(control.follow, [WALLET]);
});

test('ticked proposals are picked up by number', () => {
  const control = parseControl('## Approve proposals\n\n- [x] #3 Tighter trail\n- [ ] #4 Wider stop\n- [X] 7 Something\n');
  assert.deepEqual(control.approve, [3, 7]);
});

test('a mangled Control note does not take the bot down', () => {
  const control = parseControl('# Control\n\nsome prose\n## Never buy\nnot a bullet\n- \n');
  assert.deepEqual(control, { pause: false, neverBuy: [], follow: [], approve: [] });
  assert.deepEqual(parseControl(null), { pause: false, neverBuy: [], follow: [], approve: [] });
});

test('a section only reads to the next heading', () => {
  const control = parseControl(`## Never buy\n- ${MINT}\n## Wallets to follow\n- ${WALLET}\n`);
  assert.deepEqual(control.neverBuy, [MINT]);
  assert.deepEqual(control.follow, [WALLET]);
});

test('the brain creates its folders and a Control note you can tick', () => {
  ensureBrain();
  assert.ok(fs.existsSync(path.join(brainDir(), 'Control.md')));
  assert.ok(fs.existsSync(path.join(brainDir(), 'Journal')));
  assert.ok(fs.existsSync(path.join(brainDir(), 'Tokens')));
  assert.equal(readControl().pause, false);
  assert.match(CONTROL_TEMPLATE, /pause trading/);
});

test('ticking a proposal in the note, then unticking it once handled', () => {
  ensureBrain();
  const file = path.join(brainDir(), 'Control.md');
  fs.writeFileSync(file, '## Approve proposals\n\n- [x] #2 Tighter trail\n');
  assert.deepEqual(readControl().approve, [2]);
  untickProposal(2);
  assert.deepEqual(readControl().approve, []);
});

test('the home note carries the money block and the open positions', () => {
  const state = freshState();
  const file = writeHome(state, [{ symbol: 'AAA', costUsd: 8, entryPriceUsd: 1, lastPriceUsd: 1.5, openedAt: Date.now() - 60000 }], { readiness: 'NOT YET' });
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /Wallet \*\*\$58\.00\*\*/);
  assert.match(text, /AAA/);
  assert.match(text, /NOT YET/);
});

test('a token note has frontmatter a query can read', () => {
  const trade = {
    mint: MINT, symbol: 'AAA', pnlUsd: 5.5, pnlPct: 65, peakMultiple: 2.4, holdMs: 3_600_000,
    outcome: 'WIN', reason: 'take_profit', openedAt: Date.now() - 3_600_000, closedAt: Date.now(), score: 71,
  };
  const file = tokenNote(trade, { why: 'strong buy pressure', safety: { rugcheck: 300 }, timeline: ['bought'], lesson: 'it worked' });
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /^---\n/);
  assert.match(text, /pnl: 5\.5/);
  assert.match(text, /outcome: WIN/);
  assert.match(text, /strong buy pressure/);
  assert.match(text, /it worked/);
});

test('a wallet note says why it is followed, or why not', () => {
  const file = walletNote({ owner: WALLET, trips: 22, winRate: 0.6, medianHoldMs: 40 * 60_000, pnlUsd: 900, ok: true, reasons: [] });
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /round_trips: 22/);
  assert.match(text, /following: true/);
});

test('lessons are appended, never overwritten', () => {
  lesson('one');
  lesson('two');
  const text = fs.readFileSync(path.join(brainDir(), 'Lessons.md'), 'utf8');
  assert.match(text, /one/);
  assert.match(text, /two/);
});

test('the Rules note renders the live config and the change history', () => {
  writeRules([{ at: Date.now(), n: 1, title: 'Tighter trail', changes: { TRAILING_STOP_PCT: { from: 0.3, to: 0.22 } } }]);
  const text = fs.readFileSync(path.join(brainDir(), 'Rules.md'), 'utf8');
  assert.match(text, /TAKE_PROFIT_X/);
  assert.match(text, /Tighter trail/);
  assert.match(text, /0\.3 → 0\.22/);
});

test('the Proposals note gives pending ones a tick box', () => {
  writeProposals([{ n: 1, title: 'A', status: 'pending', evidence: 'replay', changes: { TAKE_PROFIT_X: { from: 2.5, to: 2 } } }]);
  const text = fs.readFileSync(path.join(brainDir(), 'Proposals.md'), 'utf8');
  assert.match(text, /- \[ \] #1 \*\*A\*\*/);
  assert.match(text, /never be proposed/);
});
