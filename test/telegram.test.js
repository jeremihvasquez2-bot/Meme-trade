import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePairCode, attemptPair, getPairedChatId, isFromPairedChat } from '../src/telegram/pairing.js';
import { parseCommand, buildReply } from '../src/telegram/commands.js';
import { matchKeywordAnswer } from '../src/telegram/qa.js';
import { tmpConfig } from './helpers.js';

test('pairing: a correct fresh code pairs the chat, only that chat is then authorized', () => {
  const config = tmpConfig();
  const code = generatePairCode(config.dataDir);
  assert.equal(attemptPair(config.dataDir, 'wrong', 111), false);
  assert.equal(attemptPair(config.dataDir, code, 111), true);
  assert.equal(getPairedChatId(config.dataDir), 111);
  assert.equal(isFromPairedChat(config.dataDir, 111), true);
  assert.equal(isFromPairedChat(config.dataDir, 222), false);
});

test('pairing: an expired code is refused', () => {
  const config = tmpConfig();
  const code = generatePairCode(config.dataDir);
  const before = Date.now;
  Date.now = () => before() + 20 * 60 * 1000;
  try {
    assert.equal(attemptPair(config.dataDir, code, 111), false);
  } finally {
    Date.now = before;
  }
});

test('parseCommand splits command and args, ignores plain text', () => {
  assert.deepEqual(parseCommand('/approve 3'), { command: 'approve', args: ['3'] });
  assert.deepEqual(parseCommand('/stop confirm'), { command: 'stop', args: ['confirm'] });
  assert.equal(parseCommand('how much did you make'), null);
});

test('/stop without confirm asks for confirmation and takes no action', () => {
  const { reply, action } = buildReply('stop', [], {});
  assert.match(reply, /confirm/);
  assert.equal(action, null);
});

test('/stop confirm returns a stop action', () => {
  const { action } = buildReply('stop', ['confirm'], {});
  assert.deepEqual(action, { type: 'stop' });
});

test('/approve N returns an approve action with the parsed id', () => {
  const { action } = buildReply('approve', ['7'], {});
  assert.deepEqual(action, { type: 'approve', id: 7 });
});

test('qa keyword matcher answers "how much made"', () => {
  const answer = matchKeywordAnswer('how much made so far?', { summary: { made: 42, wins: 3, lost: 0, losses: 0 } });
  assert.match(answer, /\$42\.00/);
});

test('qa keyword matcher answers "why did you sell X" from trade history', () => {
  const ctx = { trades: [{ symbol: 'DOGE', exitReason: 'stop_loss', pnlUsd: -3 }] };
  const answer = matchKeywordAnswer('why did you sell doge', ctx);
  assert.match(answer, /stop_loss/);
});

test('qa keyword matcher returns null for unmatched text', () => {
  assert.equal(matchKeywordAnswer('what is the meaning of life', {}), null);
});
