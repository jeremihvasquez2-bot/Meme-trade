import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = path.join(ROOT, '.env');
const ENV_EXAMPLE = path.join(ROOT, '.env.example');

const VALIDATORS = {
  MODE: (v) => ['paper', 'live'].includes(v) || 'must be "paper" or "live"',
  BANKROLL_USD: (v) => (Number(v) > 0 ? true : 'must be a positive number'),
  DELETE_ON_KILL: (v) => ['true', 'false'].includes(v) || 'must be "true" or "false"',
  TELEGRAM_BOT_TOKEN: (v) => /^\d+:[\w-]{30,}$/.test(v) || 'does not look like a Telegram bot token (from @BotFather)',
  TELEGRAM_CHAT_ID: (v) => /^-?\d+$/.test(v) || 'must be numeric',
  SOLANA_TRACKER_API_KEY: (v) => v.length > 10 || 'looks too short to be a real key',
  HELIUS_API_KEY: (v) => v.length > 10 || 'looks too short to be a real key',
  ANTHROPIC_API_KEY: (v) => v.startsWith('sk-ant-') || 'Anthropic API keys start with sk-ant-',
  WALLET_PRIVATE_KEY: async (v) => {
    try {
      const bs58 = (await import('bs58')).default;
      const { Keypair } = await import('@solana/web3.js');
      const decoded = bs58.decode(v);
      Keypair.fromSecretKey(decoded);
      return true;
    } catch {
      return 'not a valid base58-encoded Solana private key (export it from Phantom: Settings -> Export Private Key)';
    }
  },
  RPC_URL: (v) => v.startsWith('http') || 'must be a URL',
  BRAIN_DIR: () => true,
};

async function main() {
  const [name, ...rest] = process.argv.slice(2);
  const value = rest.join(' ');

  if (!name || value === undefined || value === '') {
    console.log('Usage: node set-key.js NAME value');
    console.log(`Known names: ${Object.keys(VALIDATORS).join(', ')}`);
    process.exit(1);
  }

  const validator = VALIDATORS[name];
  if (!validator) {
    console.error(`Unknown key "${name}". Known: ${Object.keys(VALIDATORS).join(', ')}`);
    process.exit(1);
  }

  const result = await validator(value);
  if (result !== true) {
    console.error(`Rejected: ${result}`);
    process.exit(1);
  }

  if (!fs.existsSync(ENV_FILE)) {
    fs.copyFileSync(ENV_EXAMPLE, ENV_FILE);
  }

  const lines = fs.readFileSync(ENV_FILE, 'utf8').split('\n');
  let found = false;
  const next = lines.map((line) => {
    if (line.startsWith(`${name}=`)) {
      found = true;
      return `${name}=${value}`;
    }
    return line;
  });
  if (!found) next.push(`${name}=${value}`);

  fs.writeFileSync(ENV_FILE, next.join('\n'));
  console.log(`Set ${name} in .env.`);
}

main();
