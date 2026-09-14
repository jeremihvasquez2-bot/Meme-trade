#!/usr/bin/env node
// Usage: node propose.js "<title>" "<evidence>" KEY=value [KEY=value ...]
import { propose, describe } from './src/proposals.js';
import { tunableKeys } from './src/config.js';

const [, , title, evidence, ...pairs] = process.argv;

if (!title || !pairs.length) {
  console.log('Usage: node propose.js "<title>" "<evidence>" KEY=value [KEY=value ...]\n');
  console.log('Example:');
  console.log('  node propose.js "Tighter trail" "replay over 120 paths: +11.2%/trade vs +8.1%" TRAILING_STOP_PCT=0.22\n');
  console.log(`Changeable keys:\n  ${tunableKeys().join('\n  ')}\n`);
  console.log('Risk limits, position size and the kill switch are locked and can never be proposed.');
  process.exit(pairs.length ? 1 : 0);
}

const changes = {};
for (const pair of pairs) {
  const eq = pair.indexOf('=');
  if (eq < 0) {
    console.error(`✗ "${pair}" is not KEY=value`);
    process.exit(1);
  }
  changes[pair.slice(0, eq)] = pair.slice(eq + 1);
}

try {
  const proposal = propose({ title, evidence, changes });
  console.log(`✓ Proposal #${proposal.n} recorded.\n`);
  console.log(describe(proposal));
  console.log('\nApprove with /approve in Telegram, or tick it in Control.md. Nothing changes until you do.');
} catch (err) {
  console.error(`✗ ${err.message}`);
  process.exit(1);
}
