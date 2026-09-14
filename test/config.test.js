import test from 'node:test';
import assert from 'node:assert/strict';
import './helper.js';
import fs from 'node:fs';
import path from 'node:path';
import { freshData, cleanup } from './helper.js';
import { cfg, parseEnvFile, isLocked, reload, tunableKeys } from '../src/config.js';

test.after(cleanup);

test('parseEnvFile ignores comments and strips quotes', () => {
  const parsed = parseEnvFile('# a comment\nA=1\nB="two words"\n\nC=\nBAD_LINE\n');
  assert.equal(parsed.A, '1');
  assert.equal(parsed.B, 'two words');
  assert.equal(parsed.C, '');
  assert.equal(parsed.BAD_LINE, undefined);
});

test('defaults are sane and paper-first', () => {
  freshData();
  assert.equal(cfg.MODE, 'paper');
  assert.equal(cfg.BANKROLL_USD, 50);
  assert.equal(cfg.POSITION_PCT, 0.16);
});

test('risk keys are locked and exit rules are not', () => {
  assert.ok(isLocked('POSITION_PCT'));
  assert.ok(isLocked('BANKROLL_USD'));
  assert.ok(isLocked('KILL_SWITCH_DELETE_PROJECT'));
  assert.ok(isLocked('WALLET_PRIVATE_KEY'));
  assert.ok(!isLocked('TAKE_PROFIT_X'));
  assert.ok(isLocked('SOMETHING_MADE_UP'));
});

test('tune.json overrides an unlocked key', () => {
  const dirs = freshData();
  fs.writeFileSync(path.join(dirs.data, 'tune.json'), JSON.stringify({ TAKE_PROFIT_X: 3.5 }));
  reload();
  assert.equal(cfg.TAKE_PROFIT_X, 3.5);
});

test('tune.json cannot override a locked key', () => {
  const dirs = freshData();
  fs.writeFileSync(path.join(dirs.data, 'tune.json'), JSON.stringify({ POSITION_PCT: 0.9, BANKROLL_USD: 100000 }));
  reload();
  assert.equal(cfg.POSITION_PCT, 0.16);
  assert.equal(cfg.BANKROLL_USD, 50);
});

test('tunable keys exclude every locked key', () => {
  assert.ok(tunableKeys().includes('STOP_LOSS_PCT'));
  assert.ok(!tunableKeys().some((k) => isLocked(k)));
});
