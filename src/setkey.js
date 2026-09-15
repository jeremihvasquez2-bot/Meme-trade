// Validation and .env writing for set-key.js and the phone setup page.
// Keys go from your fingers to a local file. They never go through a chat.
import fs from 'node:fs';
import { envPath, reload } from './config.js';
import { isBase58 } from './b58.js';
import { keypairFromSecret } from './wallet.js';

export const KEYS = {
  TELEGRAM_BOT_TOKEN: {
    label: 'Telegram bot token',
    hint: 'from @BotFather, looks like 123456789:AA...',
    phone: true,
    validate: (v) => (/^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(v) ? '' : 'that does not look like a BotFather token (digits, a colon, then ~35 characters)'),
  },
  SOLANA_TRACKER_KEY: {
    label: 'Solana Tracker Data API key',
    hint: 'from solanatracker.io → Data API',
    phone: true,
    validate: (v) => (v.length >= 20 ? '' : 'that looks too short for a Solana Tracker key'),
  },
  ANTHROPIC_API_KEY: {
    label: 'Anthropic API key (optional)',
    hint: 'sk-ant-...',
    phone: true,
    validate: (v) => (v.startsWith('sk-ant-') ? '' : 'an Anthropic key starts with sk-ant-'),
  },
  RPC_URL: {
    label: 'Solana RPC URL',
    hint: 'e.g. your Helius URL',
    phone: true,
    validate: (v) => (/^https:\/\/\S+$/.test(v) ? '' : 'must be an https:// URL'),
  },
  BRAIN_DIR: {
    label: 'Obsidian folder',
    hint: 'where the notes go',
    phone: true,
    validate: () => '',
  },
  MODE: {
    label: 'Mode',
    hint: 'paper or live',
    phone: false,
    validate: (v) => (['paper', 'live'].includes(v) ? '' : "mode must be 'paper' or 'live'"),
  },
  BANKROLL_USD: {
    label: 'Bankroll in USD',
    hint: 'the most you are prepared to lose',
    phone: false,
    validate: (v) => (Number(v) > 0 ? '' : 'bankroll must be a positive number'),
  },
  WALLET_PRIVATE_KEY: {
    label: 'Wallet private key',
    hint: 'PC ONLY — never from the phone page, never through a chat',
    phone: false,
    validate: (v) => {
      if (!isBase58(v, [32, 64])) return 'that is not a base58 Solana private key (Phantom exports 88 characters)';
      try {
        keypairFromSecret(v);
        return '';
      } catch (err) {
        return err.message;
      }
    },
  },
};

export function validate(name, value) {
  const spec = KEYS[name];
  if (!spec) return `unknown key ${name}. Known keys: ${Object.keys(KEYS).join(', ')}`;
  const v = String(value ?? '').trim();
  if (!v) return `${name} cannot be empty`;
  return spec.validate(v);
}

/** Rewrite one key in .env in place, keeping comments and order. */
export function setKey(name, value) {
  const error = validate(name, value);
  if (error) throw new Error(error);
  const v = String(value).trim();
  let text = '';
  try {
    text = fs.readFileSync(envPath, 'utf8');
  } catch {
    try {
      text = fs.readFileSync(`${envPath}.example`, 'utf8');
    } catch {
      text = '';
    }
  }
  const line = `${name}=${v}`;
  const re = new RegExp(`^${name}=.*$`, 'm');
  const next = re.test(text) ? text.replace(re, line) : `${text}${text.endsWith('\n') || !text ? '' : '\n'}${line}\n`;
  fs.writeFileSync(envPath, next, { mode: 0o600 });
  reload();
  return { name, saved: true };
}

export function mask(value) {
  const v = String(value || '');
  if (!v) return '(not set)';
  return v.length <= 8 ? '********' : `${v.slice(0, 4)}…${v.slice(-4)}`;
}
