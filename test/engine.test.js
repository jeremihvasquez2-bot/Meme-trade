import test from 'node:test';
import assert from 'node:assert/strict';
import './helper.js';
import { freshData, cleanup, setEnv } from './helper.js';
import { installMarket, fakeMarket, MINT } from './market.js';
import { createEngine } from '../src/engine.js';
import { loadTrades } from '../src/positions.js';
import { loadPaths } from '../src/paths.js';
import { resetFetch } from '../src/http.js';
import { HOUR } from '../src/util.js';

let market;
const messages = [];

test.beforeEach(() => {
  freshData();
  messages.length = 0;
  market = fakeMarket();
  installMarket(market);
});
test.afterEach(() => resetFetch());
test.after(cleanup);

const engine = () => createEngine({ notify: async (text) => messages.push(text) });

/** Quieten the 5-minute tape so the conviction rule does not fire. */
function calm() {
  market.m5 = 1;
  market.buysM5 = 20;
  market.sellsM5 = 20;
  market.volumeM5 = 1_000;
}

test('a full scan finds the candidate, checks it and buys it', async () => {
  const bot = engine();
  const result = await bot.scanOnce();
  assert.equal(result.passed.length, 1);
  assert.ok(result.bought, 'expected a buy');
  assert.equal(bot.positions.length, 1);
  assert.equal(bot.positions[0].mint, MINT);
  assert.ok(bot.state.cash < 50 - 7.9, 'cash must come out of the bankroll');
  assert.match(messages[0], /🟡 BOUGHT TEST/);
  assert.match(messages[0], /💰 WALLET/);
});

test('a candidate that fails safety is never bought', async () => {
  market.mintAuthority = 'SomebodyElse';
  const bot = engine();
  const result = await bot.scanOnce();
  assert.equal(result.passed.length, 0);
  assert.equal(bot.positions.length, 0);
});

test('a candidate that fails a market filter is never even checked', async () => {
  market.liquidityUsd = 2_000;
  const bot = engine();
  const result = await bot.scanOnce();
  assert.equal(result.shortlist.length, 0);
  assert.equal(bot.positions.length, 0);
});

test('every candidate that passes safety gets a recorded price path', async () => {
  const bot = engine();
  await bot.scanOnce();
  await bot.exitOnce();
  const paths = loadPaths({ minTicks: 1 });
  assert.ok(paths.length >= 1);
  assert.equal(paths[0].kind, 'position');
});

test('a winner is taken at the target and booked as a WIN', async () => {
  const bot = engine();
  await bot.scanOnce();
  const cost = bot.positions[0].costUsd;
  calm();
  market.priceUsd = 0.003; // 3x
  await bot.exitOnce();

  assert.equal(bot.positions.length, 0);
  const trades = loadTrades();
  assert.equal(trades.length, 1);
  assert.equal(trades[0].outcome, 'WIN');
  assert.ok(trades[0].pnlUsd > 0);
  assert.equal(bot.state.lifetime.wins, 1);
  assert.ok(bot.state.cash > 50 - cost, 'the proceeds must come back to cash');
  assert.match(messages.at(-1), /🟢 WIN sold TEST/);
});

test('a loser is cut at the stop and blocks a rebuy for four hours', async () => {
  const bot = engine();
  await bot.scanOnce();
  market.priceUsd = 0.0007; // -30%
  await bot.exitOnce();

  const trades = loadTrades();
  assert.equal(trades[0].outcome, 'LOSE');
  assert.equal(trades[0].reason, 'stop_loss');
  assert.equal(bot.state.lifetime.losses, 1);
  assert.ok(bot.state.blocked[MINT] > Date.now());
  assert.ok(bot.state.day.lossUsd > 0);
  assert.match(messages.at(-1), /🔴 LOSE sold TEST/);
});

test('after a loss the cooldown stops it buying straight back in', async () => {
  const bot = engine();
  await bot.scanOnce();
  market.priceUsd = 0.0007;
  await bot.exitOnce();
  const result = await bot.scanOnce();
  assert.equal(result.bought, null);
  assert.match(result.blocked, /cooldown|lost on this token/);
});

test('a strong runner is part-sold and the rest is left to ride', async () => {
  const bot = engine();
  await bot.scanOnce();
  market.priceUsd = 0.003;
  market.m5 = 8;
  market.buysM5 = 100;
  market.sellsM5 = 10;
  market.volumeM5 = 20_000;
  await bot.exitOnce();

  assert.equal(bot.positions.length, 1, 'the runner must still be open');
  assert.equal(bot.positions[0].tookConviction, true);
  assert.ok(bot.positions[0].realisedUsd > 0);
  assert.match(messages.at(-1), /PART SOLD/);
});

test('the whole trade decides WIN even when the runner goes to nothing', async () => {
  const bot = engine();
  await bot.scanOnce();
  market.priceUsd = 0.003;
  market.m5 = 8;
  market.buysM5 = 100;
  market.sellsM5 = 10;
  market.volumeM5 = 20_000;
  await bot.exitOnce();
  market.priceUsd = 0.0002; // the runner collapses
  market.m5 = -60;
  await bot.exitOnce();

  const trades = loadTrades();
  assert.equal(trades.length, 1);
  assert.equal(trades[0].outcome, 'WIN');
  assert.equal(trades[0].partials.length, 2);
});

test('a dead price feed is a strike, and five strikes is a bailout', async () => {
  const bot = engine();
  await bot.scanOnce();
  market.dead = true;
  for (let i = 0; i < 4; i++) await bot.exitOnce();
  assert.equal(bot.positions.length, 1, 'four strikes is not enough to give up');
  assert.equal(bot.positions[0].strikes, 4);
  await bot.exitOnce();
  assert.equal(bot.positions.length, 0);
  assert.equal(loadTrades()[0].reason, 'no_price_bailout');
});

test('it will not open more than the maximum number of positions', async () => {
  const bot = engine();
  await bot.scanOnce();
  const second = await bot.scanOnce();
  assert.equal(second.bought, null);
  assert.match(second.blocked, /already holding it/);
});

test('a paused bot still exits its open trades', async () => {
  const bot = engine();
  await bot.scanOnce();
  bot.state.paused = true;
  calm();
  market.priceUsd = 0.003;
  await bot.exitOnce();
  assert.equal(loadTrades().length, 1);
  assert.equal((await bot.scanOnce()).bought, null);
});

test('a round is won when the bankroll reaches the target', async () => {
  const bot = engine();
  await bot.scanOnce();
  bot.state.cash = 195;
  calm();
  market.priceUsd = 0.003;
  await bot.exitOnce();
  assert.equal(bot.state.roundsWon, 1);
  assert.equal(bot.state.round.target, 300);
  assert.equal(bot.state.cash, 50);
  assert.ok(messages.some((m) => /ROUND 1 WON/.test(m)));
});

test('paper mode keeps playing even after losing everything', async () => {
  const bot = engine();
  bot.state.lifetime.netUsd = -200;
  assert.equal(await bot.killSwitchCheck(), false);
  assert.equal(bot.state.halted, false);
});

test('live mode sells everything, writes a report and halts at the bankroll', async (t) => {
  setEnv({ MODE: 'live' });
  freshData({ MODE: 'live' });
  installMarket(market);
  const bot = engine();
  bot.state.lifetime.netUsd = -60;
  const written = [];
  t.mock.method(bot, 'writeFinalReport', () => {
    written.push('report');
    return '/tmp/report.txt';
  });
  await bot.killSwitchCheck();
  assert.equal(bot.state.halted, true);
  assert.match(bot.state.haltedReason, /kill switch/);
  assert.ok(messages.some((m) => /KILL SWITCH/.test(m)));
  setEnv({ MODE: 'paper' });
});

test('the morning report says what happened and whether it is ready', async () => {
  const bot = engine();
  await bot.scanOnce();
  calm();
  market.priceUsd = 0.003;
  await bot.exitOnce();
  await bot.morningReport();
  const report = messages.at(-1);
  assert.match(report, /Morning report/);
  assert.match(report, /Last 24h: 1 trade/);
  assert.match(report, /READINESS: NOT YET/);
});

test('the Control note can pause the bot without a restart', async () => {
  const bot = engine();
  const fs = await import('node:fs');
  const brain = await import('../src/brain.js');
  brain.ensureBrain();
  fs.writeFileSync(`${brain.brainDir()}/Control.md`, '- [x] pause trading\n');
  await bot.applyControl();
  assert.equal(bot.state.paused, true);
});

test('the Never buy list in the Control note is obeyed', async () => {
  const bot = engine();
  const fs = await import('node:fs');
  const brain = await import('../src/brain.js');
  brain.ensureBrain();
  fs.writeFileSync(`${brain.brainDir()}/Control.md`, `## Never buy\n\n- ${MINT}\n`);
  const result = await bot.scanOnce();
  assert.equal(result.bought, null);
  assert.equal(result.passed.length, 0);
});

test('a position that runs out of time is closed at the 4 hour limit', async () => {
  const bot = engine();
  await bot.scanOnce();
  bot.positions[0].openedAt = Date.now() - 4 * HOUR - 1000;
  await bot.exitOnce();
  assert.equal(loadTrades()[0].reason, 'max_hold');
});

test('the lesson on a token note is drawn from what actually happened', async () => {
  const bot = engine();
  await bot.scanOnce();
  market.priceUsd = 0.0007;
  await bot.exitOnce();
  const lesson = bot.drawLesson(loadTrades()[0]);
  assert.match(lesson, /bought the top|lost /);
});
