import test from 'node:test';
import assert from 'node:assert/strict';
import './helper.js';
import { freshData, cleanup } from './helper.js';
import { cfg } from '../src/config.js';
import { propose, approve, reject, pending, loadProposals, loadTune, loadHistory, describe } from '../src/proposals.js';

const pass = () => ({ ok: true, output: '' });
const fail = () => ({ ok: false, output: 'FAIL 1 test failed' });

test.beforeEach(() => freshData());
test.after(cleanup);

test('a proposal records where each value is coming from and going to', () => {
  const p = propose({ title: 'Tighter trail', evidence: 'replay over 120 paths', changes: { TRAILING_STOP_PCT: 0.22 } });
  assert.equal(p.n, 1);
  assert.equal(p.status, 'pending');
  assert.equal(p.changes.TRAILING_STOP_PCT.from, 0.3);
  assert.equal(p.changes.TRAILING_STOP_PCT.to, 0.22);
});

test('position size can never be proposed', () => {
  assert.throws(() => propose({ title: 'bigger bets', evidence: 'vibes', changes: { POSITION_PCT: 0.5 } }), /locked/);
});

test('the kill switch and the bankroll can never be proposed', () => {
  assert.throws(() => propose({ title: 'x', evidence: 'y', changes: { KILL_SWITCH_DELETE_PROJECT: true } }), /locked/);
  assert.throws(() => propose({ title: 'x', evidence: 'y', changes: { BANKROLL_USD: 5000 } }), /locked/);
  assert.throws(() => propose({ title: 'x', evidence: 'y', changes: { MAX_OPEN_POSITIONS: 20 } }), /locked/);
});

test('an unknown key is refused too', () => {
  assert.throws(() => propose({ title: 'x', evidence: 'y', changes: { MADE_UP_KEY: 1 } }), /locked/);
});

test('a proposal needs a title and at least one change', () => {
  assert.throws(() => propose({ title: '', evidence: 'y', changes: { TAKE_PROFIT_X: 3 } }), /title/);
  assert.throws(() => propose({ title: 'x', evidence: 'y', changes: {} }), /at least one/);
});

test('approving applies the change and writes it to the tune file', () => {
  propose({ title: 'Take profit sooner', evidence: 'replay', changes: { TAKE_PROFIT_X: 2 } });
  const result = approve(1, { runTests: pass });
  assert.equal(result.ok, true);
  assert.equal(cfg.TAKE_PROFIT_X, 2);
  assert.equal(loadTune().TAKE_PROFIT_X, 2);
  assert.equal(loadProposals()[0].status, 'approved');
});

test('a failing test suite reverts the change', () => {
  const before = cfg.TAKE_PROFIT_X;
  propose({ title: 'Something that breaks it', evidence: 'none', changes: { TAKE_PROFIT_X: 99 } });
  const result = approve(1, { runTests: fail });
  assert.equal(result.ok, false);
  assert.equal(cfg.TAKE_PROFIT_X, before, 'the live config must be back where it started');
  assert.equal(loadTune().TAKE_PROFIT_X, undefined);
  assert.equal(loadProposals()[0].status, 'failed');
});

test('an approved change is remembered in the tune history', () => {
  propose({ title: 'Wider stop', evidence: 'replay', changes: { STOP_LOSS_PCT: 0.3 } });
  approve(1, { runTests: pass });
  const history = loadHistory();
  assert.equal(history.length, 1);
  assert.equal(history[0].title, 'Wider stop');
});

test('a proposal can be rejected and then cannot be approved', () => {
  propose({ title: 'No thanks', evidence: '', changes: { TAKE_PROFIT_X: 3 } });
  reject(1);
  assert.equal(loadProposals()[0].status, 'rejected');
  assert.throws(() => approve(1, { runTests: pass }), /already rejected/);
});

test('the same proposal cannot be applied twice', () => {
  propose({ title: 'Once', evidence: '', changes: { TAKE_PROFIT_X: 2.2 } });
  approve(1, { runTests: pass });
  assert.throws(() => approve(1, { runTests: pass }), /already approved/);
});

test('approving something that does not exist is an error, not a crash', () => {
  assert.throws(() => approve(42, { runTests: pass }), /no proposal 42/);
});

test('pending lists only what is still waiting on you', () => {
  propose({ title: 'A', evidence: '', changes: { TAKE_PROFIT_X: 2.1 } });
  propose({ title: 'B', evidence: '', changes: { STOP_LOSS_PCT: 0.2 } });
  reject(2);
  assert.equal(pending().length, 1);
  assert.equal(pending()[0].title, 'A');
});

test('a proposal describes itself in a way you can read on a phone', () => {
  const p = propose({ title: 'Tighter trail', evidence: 'replay over 120 paths: +11.2% vs +8.1%', changes: { TRAILING_STOP_PCT: 0.22 } });
  const text = describe(p);
  assert.match(text, /#1 Tighter trail/);
  assert.match(text, /TRAILING_STOP_PCT: 0\.3 → 0\.22/);
  assert.match(text, /replay over 120 paths/);
});
