// Configuration. Three layers, lowest first:
//   1. the defaults below
//   2. .env  (or the real process environment)
//   3. data/tune.json  — values changed by an approved proposal
//
// Anything that decides how much money is at stake lives in LOCKED_KEYS and
// can only ever be changed by a human editing .env. The proposals system is
// not allowed to touch it.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

export const LOCKED_KEYS = new Set([
  'MODE',
  'BANKROLL_USD',
  'POSITION_PCT',
  'MIN_POSITION_USD',
  'MAX_POSITION_USD',
  'DAILY_LOSS_CAP_PCT',
  'DAILY_LOSS_CAP_MIN_USD',
  'MAX_OPEN_POSITIONS',
  'KILL_SWITCH_DELETE_PROJECT',
  'WALLET_PRIVATE_KEY',
  'TELEGRAM_BOT_TOKEN',
  'SOLANA_TRACKER_KEY',
  'ANTHROPIC_API_KEY',
  'RPC_URL',
  'DATA_DIR',
  'BRAIN_DIR',
]);

const DEFAULTS = {
  MODE: 'paper',
  BANKROLL_USD: 50,

  TELEGRAM_BOT_TOKEN: '',
  SOLANA_TRACKER_KEY: '',
  ANTHROPIC_API_KEY: '',
  RPC_URL: 'https://api.mainnet-beta.solana.com',
  BRAIN_DIR: '',
  WALLET_PRIVATE_KEY: '',

  POSITION_PCT: 0.16,
  MIN_POSITION_USD: 5,
  MAX_POSITION_USD: 250,
  DAILY_LOSS_CAP_PCT: 0.30,
  DAILY_LOSS_CAP_MIN_USD: 15,
  MAX_OPEN_POSITIONS: 3,
  COOLDOWN_AFTER_LOSS_MIN: 15,
  REBUY_BLOCK_HOURS: 4,
  KILL_SWITCH_DELETE_PROJECT: false,

  TAKE_PROFIT_X: 2.5,
  STOP_LOSS_PCT: 0.25,
  TRAILING_STOP_PCT: 0.30,
  MAX_HOLD_HOURS: 4,
  CONVICTION_KEEP_PCT: 0.25,
  CONVICTION_MIN_BUY_SELL: 2,
  CONVICTION_MIN_M5_PCT: 3,
  CONVICTION_MIN_VOL_M5_USD: 5000,
  MAX_PRICE_STRIKES: 5,

  MIN_LIQUIDITY_USD: 15000,
  MAX_LIQUIDITY_USD: 500000,
  MIN_VOLUME_H1_USD: 20000,
  MIN_AGE_MINUTES: 20,
  MAX_AGE_HOURS: 72,
  MIN_MARKET_CAP_USD: 50000,
  MAX_MARKET_CAP_USD: 5000000,
  MIN_BUY_SELL_RATIO_M5: 1.2,
  MAX_RUGCHECK_SCORE: 2000,
  MAX_PRICE_IMPACT_PCT: 8,
  SCORE_THRESHOLD: 60,
  SMART_MONEY_MIN_WALLETS: 2,
  SMART_MONEY_SCORE_BOOST: 12,

  SCAN_INTERVAL_MS: 45000,
  EXIT_INTERVAL_MS: 15000,
  WALLET_POLL_INTERVAL_MS: 60000,
  SHADOW_PATH_HOURS: 6,
  PATH_TICK_MS: 15000,
  MORNING_REPORT_HOUR: 7,

  ROUND_TARGET_START_USD: 200,
  ROUND_TARGET_STEP_USD: 100,

  PRIORITY_FEE_MAX_LAMPORTS: 500000,
  SOL_FEE_BUFFER: 0.01,
  SLIPPAGE_BPS: 300,

  TRACKER_MONTHLY_BUDGET: 2500,
  MONTHLY_PROFIT_TARGET_USD: 500,

  // readiness gate
  READY_MIN_TRADES: 30,
  READY_MIN_DAYS: 14,
  READY_MIN_PNL_USD: 10,
  READY_MIN_PATHS: 40,
  READY_MIN_REPLAY_PCT: 8,
  READY_MIN_ROUNDS_WON: 3,
  READY_MIN_PROFITABLE_WEEKS: 2,
};

export function parseEnvFile(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function coerce(key, value) {
  const d = DEFAULTS[key];
  if (typeof d === 'number') {
    const n = Number(value);
    return Number.isFinite(n) ? n : d;
  }
  if (typeof d === 'boolean') return /^(1|true|yes|on)$/i.test(String(value));
  return String(value);
}

export const envPath = path.join(ROOT, '.env');

function loadEnvFile() {
  try {
    return parseEnvFile(fs.readFileSync(envPath, 'utf8'));
  } catch {
    return {};
  }
}

function tuneFile(dataDir) {
  return path.join(dataDir, 'tune.json');
}

function loadTune(dataDir) {
  try {
    return JSON.parse(fs.readFileSync(tuneFile(dataDir), 'utf8'));
  } catch {
    return {};
  }
}

function resolveDataDir(fileEnv) {
  const raw = process.env.DATA_DIR || fileEnv.DATA_DIR || path.join(ROOT, 'data');
  return path.resolve(raw);
}

function resolveBrainDir(value, dataDir) {
  if (value) return path.resolve(value);
  const home = os.homedir();
  for (const guess of ['Obsidian', 'Documents/Obsidian', 'Documents']) {
    const dir = path.join(home, guess);
    if (fs.existsSync(dir)) return path.join(dir, 'Agents', 'MEMEBOT');
  }
  return path.join(dataDir, 'brain');
}

export const cfg = {};

/** Rebuild `cfg` from disk + environment. Safe to call at any time. */
export function reload() {
  const fileEnv = loadEnvFile();
  const dataDir = resolveDataDir(fileEnv);
  const tune = loadTune(dataDir);

  for (const key of Object.keys(cfg)) delete cfg[key];
  for (const [key, value] of Object.entries(DEFAULTS)) cfg[key] = value;

  for (const key of Object.keys(DEFAULTS)) {
    // .env then the real environment then tune.json — later wins.
    if (fileEnv[key] !== undefined && fileEnv[key] !== '') cfg[key] = coerce(key, fileEnv[key]);
    if (process.env[key] !== undefined && process.env[key] !== '') cfg[key] = coerce(key, process.env[key]);
    if (!LOCKED_KEYS.has(key) && tune[key] !== undefined) cfg[key] = coerce(key, tune[key]);
  }

  cfg.ROOT = ROOT;
  cfg.DATA_DIR = dataDir;
  cfg.BRAIN_DIR = resolveBrainDir(cfg.BRAIN_DIR, dataDir);
  cfg.MODE = cfg.MODE === 'live' ? 'live' : 'paper';
  cfg.TUNE_FILE = tuneFile(dataDir);
  cfg.DEFAULTS = DEFAULTS;
  return cfg;
}

/** Keys a proposal is allowed to change, with their current values. */
export function tunableKeys() {
  return Object.keys(DEFAULTS).filter((k) => !LOCKED_KEYS.has(k)).sort();
}

export function isLocked(key) {
  return LOCKED_KEYS.has(key) || !(key in DEFAULTS);
}

reload();
