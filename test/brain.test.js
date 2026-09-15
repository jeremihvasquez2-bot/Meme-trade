import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseControlNote, defaultControlNote } from '../src/brain/control.js';

test('default control note parses to an inert state', () => {
  const parsed = parseControlNote(defaultControlNote());
  assert.equal(parsed.paused, false);
  assert.deepEqual(parsed.neverBuy, []);
  assert.deepEqual(parsed.followWallets, []);
  assert.deepEqual(parsed.approveIds, []);
});

test('ticking "pause trading" pauses the bot', () => {
  const md = defaultControlNote().replace('- [ ] pause trading', '- [x] pause trading');
  assert.equal(parseControlNote(md).paused, true);
});

test('never-buy and follow-wallet lists parse entries under their headings', () => {
  const md = `# Control

## Pause
- [ ] pause trading

## Never buy
- ScamMint111
- ScamMint222

## Wallets to follow
- WalletAAA

## Approve proposals
`;
  const parsed = parseControlNote(md);
  assert.deepEqual(parsed.neverBuy, ['ScamMint111', 'ScamMint222']);
  assert.deepEqual(parsed.followWallets, ['WalletAAA']);
});

test('ticked proposal checkboxes are collected by id, unticked ones are not', () => {
  const md = `# Control

## Pause
- [ ] pause trading

## Never buy

## Wallets to follow

## Approve proposals
- [x] #3 wider trailing stop
- [ ] #4 loosen liquidity floor
- [x] #5 shorten cooldown
`;
  const parsed = parseControlNote(md);
  assert.deepEqual(parsed.approveIds, [3, 5]);
});
