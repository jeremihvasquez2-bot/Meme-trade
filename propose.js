import { loadConfig } from './src/config.js';
import { createProposal } from './src/proposals/proposals.js';

const [title, evidence, ...kvArgs] = process.argv.slice(2);

if (!title || !evidence || !kvArgs.length) {
  console.log('Usage: node propose.js "<title>" "<evidence>" key=value [key2=value2 ...]');
  console.log('Example: node propose.js "wider trailing stop" "replay over 52 paths: +3.1%/trade" trailingStopPct=0.35');
  process.exit(1);
}

const changes = {};
for (const arg of kvArgs) {
  const eq = arg.indexOf('=');
  if (eq === -1) {
    console.error(`Bad argument "${arg}", expected key=value`);
    process.exit(1);
  }
  const key = arg.slice(0, eq);
  const raw = arg.slice(eq + 1);
  const value = raw === 'true' ? true : raw === 'false' ? false : Number.isNaN(Number(raw)) ? raw : Number(raw);
  changes[key] = value;
}

const config = loadConfig({});

try {
  const proposal = createProposal(config, title, evidence, changes);
  console.log(`Created proposal #${proposal.id}: ${proposal.title}`);
  for (const [key, { old, new: next }] of Object.entries(proposal.changes)) {
    console.log(`  ${key}: ${old} -> ${next}`);
  }
  console.log('\nApprove it with /approve ' + proposal.id + ' in Telegram, or by ticking it in Control.md.');
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
