#!/usr/bin/env node
// Usage: node set-key.js NAME value
import { KEYS, setKey, mask, validate } from './src/setkey.js';
import { cfg } from './src/config.js';

const [, , name, ...rest] = process.argv;
const value = rest.join(' ');

if (!name) {
  console.log('Usage: node set-key.js NAME value\n');
  console.log('Keys:');
  for (const [key, spec] of Object.entries(KEYS)) {
    const current = key === 'WALLET_PRIVATE_KEY' ? (cfg[key] ? '(set)' : '(not set)') : mask(cfg[key]);
    console.log(`  ${key.padEnd(20)} ${current.padEnd(12)} ${spec.hint}`);
  }
  console.log('\nNothing here ever goes through a chat with an AI.');
  process.exit(0);
}

const error = validate(name, value);
if (error) {
  console.error(`✗ ${error}`);
  process.exit(1);
}
setKey(name, value);
console.log(`✓ ${name} saved to .env${name === 'WALLET_PRIVATE_KEY' ? ' (and never printed again)' : ` (${mask(value)})`}`);
if (name === 'MODE' && value === 'live') {
  console.log('\n⚠️  LIVE MODE. Restart the bot for this to take effect.');
  console.log('   It will trade real money and stop for good if it loses the bankroll.');
}
