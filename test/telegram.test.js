import test from 'node:test';
import assert from 'node:assert/strict';
import './helper.js';
import { freshData, cleanup } from './helper.js';
import {
  newPairingCode, tryPair, handleMessage, loadPairing, isPaired, unpair,
  keywordAnswer, formatPositions, formatSellAlert,
} from '../src/telegram.js';

test.beforeEach(() => freshData());
test.after(cleanup);

function fakeApi() {
  const calls = [];
  const stub = (name) => (...args) => {
    calls.push([name, ...args]);
    return name;
  };
  return {
    calls,
    status: stub('status'),
    positions: stub('positions'),
    money: stub('money'),
    rounds: stub('rounds'),
    readiness: stub('readiness'),
    sims: stub('sims'),
    lessons: stub('lessons'),
    whySold: stub('whySold'),
    pause: stub('pause'),
    resume: stub('resume'),
    stop: stub('stop'),
    proposals: stub('proposals'),
    approve: stub('approve'),
    reject: stub('reject'),
    fallback: () => null,
  };
}

test('a pairing code is generated once and only once', () => {
  const first = newPairingCode();
  assert.match(first.code, /^\d{6}$/);
  assert.equal(newPairingCode().code, first.code);
});

test('the wrong code does not pair', () => {
  newPairingCode();
  const result = tryPair(111, '/start 000000');
  assert.equal(result.ok, false);
  assert.equal(isPaired(), false);
});

test('the right code pairs that chat and burns the code', () => {
  const { code } = newPairingCode();
  const result = tryPair(111, `/start ${code}`);
  assert.equal(result.ok, true);
  assert.equal(loadPairing().chatId, 111);
  assert.equal(loadPairing().code, null);
});

test('once paired, every other chat is ignored in silence', () => {
  const { code } = newPairingCode();
  tryPair(111, `/start ${code}`);
  assert.equal(handleMessage({ chatId: 222, text: '/status' }, fakeApi()), null);
});

test('before pairing it says how to pair', () => {
  newPairingCode();
  const reply = handleMessage({ chatId: 111, text: '/status' }, fakeApi());
  assert.match(reply, /npm run status/);
});

function paired() {
  const { code } = newPairingCode();
  tryPair(111, `/start ${code}`);
  return fakeApi();
}

test('the basic commands route to the right place', () => {
  const api = paired();
  for (const [text, expected] of [['/status', 'status'], ['/positions', 'positions'], ['/money', 'money'], ['/pause', 'pause'], ['/resume', 'resume'], ['/proposals', 'proposals']]) {
    assert.equal(handleMessage({ chatId: 111, text }, api), expected);
  }
});

test('/stop asks for confirmation before selling everything', () => {
  const api = paired();
  const reply = handleMessage({ chatId: 111, text: '/stop' }, api);
  assert.match(reply, /\/stop confirm/);
  assert.ok(!api.calls.some(([name]) => name === 'stop'));
  handleMessage({ chatId: 111, text: '/stop confirm' }, api);
  assert.ok(api.calls.some(([name]) => name === 'stop'));
});

test('/approve and /reject pass the number through', () => {
  const api = paired();
  handleMessage({ chatId: 111, text: '/approve 3' }, api);
  handleMessage({ chatId: 111, text: '/reject 4' }, api);
  assert.deepEqual(api.calls.find(([n]) => n === 'approve'), ['approve', 3]);
  assert.deepEqual(api.calls.find(([n]) => n === 'reject'), ['reject', 4]);
});

test('an unknown command explains itself instead of failing silently', () => {
  const api = paired();
  assert.match(handleMessage({ chatId: 111, text: '/nonsense' }, api), /I do not know/);
});

test('plain questions find the built-in answers with no AI key at all', () => {
  const api = fakeApi();
  assert.equal(keywordAnswer('how much have you made?', api), 'money');
  assert.equal(keywordAnswer('what are you holding', api), 'positions');
  assert.equal(keywordAnswer('are you ready for real money', api), 'readiness');
  assert.equal(keywordAnswer('run the sims', api), 'sims');
  assert.equal(keywordAnswer('how are the rounds going', api), 'rounds');
  assert.equal(keywordAnswer('what have you learned', api), 'lessons');
});

test('"why did you sell X" pulls the symbol out of the question', () => {
  const api = fakeApi();
  keywordAnswer('why did you sell PEPE', api);
  assert.deepEqual(api.calls.at(-1), ['whySold', 'PEPE']);
});

test('a question with no keyword falls through to the fallback', () => {
  const api = paired();
  api.fallback = () => 'fallback answer';
  assert.equal(handleMessage({ chatId: 111, text: 'what is the weather' }, api), 'fallback answer');
});

test('unpairing lets a new chat take over', () => {
  paired();
  unpair();
  assert.equal(isPaired(), false);
});

test('open positions are listed with their multiple and their cost', () => {
  const text = formatPositions([
    { symbol: 'AAA', mint: 'Mint111111111111111111111111111111111111111', costUsd: 8, entryPriceUsd: 1, lastPriceUsd: 2, openedAt: Date.now() - 60000, score: 71 },
  ]);
  assert.match(text, /AAA/);
  assert.match(text, /2\.00x/);
  assert.match(text, /🟢/);
});

test('holding nothing says so plainly', () => {
  assert.match(formatPositions([]), /Holding nothing/);
});

test('a sell alert leads with WIN or LOSE and gives both figures', () => {
  const trade = { symbol: 'AAA', outcome: 'WIN', costUsd: 8.42, proceedsUsd: 21, pnlUsd: 12.58, pnlPct: 149.4, peakMultiple: 2.8, holdMs: 3_600_000, reason: 'take_profit' };
  const text = formatSellAlert(trade, { reason: 'take_profit', fraction: 1, proceedsUsd: 21 });
  assert.match(text, /^🟢 WIN/);
  assert.match(text, /This sale: \$21/);
  assert.match(text, /Whole trade: \$8\.42 in → \$21/);
  const lose = formatSellAlert({ ...trade, outcome: 'LOSE', pnlUsd: -4 }, { reason: 'stop_loss', fraction: 1, proceedsUsd: 4 });
  assert.match(lose, /^🔴 LOSE/);
});
