import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..');

// Tunable trading rules. These are what the proposals system (src/proposals)
// is allowed to change. LOCKED_KEYS below can never be changed by a proposal.
export const DEFAULT_RULES = {
  positionSizePct: 0.16,      // fraction of current bankroll per trade
  positionMinUsd: 5,
  positionMaxUsd: 250,
  dailyCapMinUsd: 15,
  dailyCapPct: 0.30,          // fraction of bankroll, floor dailyCapMinUsd
  stopLossPct: 0.25,
  takeProfitMultiple: 2.5,
  partialTakeProfitPct: 0.75, // sold at TP when momentum still strong
  trailingStopPct: 0.30,
  maxHoldMs: 4 * 60 * 60 * 1000,
  cooldownAfterLossMs: 30 * 60 * 1000,
  rebuyBlockMs: 4 * 60 * 60 * 1000,
  maxOpenPositions: 5,
  scoreBuyThreshold: 60,
  maxMissedPriceStrikes: 5,
  roundStartTargetUsd: 200,
  roundTargetStepUsd: 100,
  scanIntervalMs: 45 * 1000,
  exitCheckIntervalMs: 15 * 1000,
  priceTickIntervalMs: 15 * 1000,
  shadowPathDurationMs: 6 * 60 * 60 * 1000,
  filters: {
    liquidityMinUsd: 15_000,
    liquidityMaxUsd: 500_000,
    volume1hMinUsd: 20_000,
    ageMinMs: 20 * 60 * 1000,
    ageMaxMs: 72 * 60 * 60 * 1000,
    mcapMinUsd: 50_000,
    mcapMaxUsd: 5_000_000,
    buySellRatioMin: 1.2,
    rugcheckScoreMax: 2000,
    sellPriceImpactMaxPct: 8,
  },
  copytrade: {
    minRoundTrips: 15,
    minMedianHoldMin: 20,
    minWinRate: 0.5,
    minFollowedHoldersForBoost: 2,
    pollIntervalMs: 60 * 1000,
    topTokensPerDay: 10,
  },
  feeBufferSol: 0.01,
  maxPriorityFeeLamports: 500_000,
};

// These can never be changed via the proposals system, no matter what evidence
// is offered. They are the hard floor that caps how much the bot can lose.
export const LOCKED_RULE_KEYS = new Set([
  'positionSizePct',
  'positionMinUsd',
  'positionMaxUsd',
  'dailyCapMinUsd',
  'dailyCapPct',
  'stopLossPct',
  'maxOpenPositions',
]);

export function loadConfig(overrides = {}) {
  const env = process.env;
  const dataDir = overrides.dataDir || path.join(ROOT_DIR, 'data');
  return {
    mode: overrides.mode || env.MODE || 'paper',
    bankrollUsd: Number(overrides.bankrollUsd ?? env.BANKROLL_USD ?? 50),
    dataDir,
    brainDir: overrides.brainDir || env.BRAIN_DIR || path.join(ROOT_DIR, 'brain'),
    telegramToken: overrides.telegramToken ?? env.TELEGRAM_BOT_TOKEN ?? '',
    telegramChatId: overrides.telegramChatId ?? env.TELEGRAM_CHAT_ID ?? '',
    solanaTrackerApiKey: overrides.solanaTrackerApiKey ?? env.SOLANA_TRACKER_API_KEY ?? '',
    heliusApiKey: overrides.heliusApiKey ?? env.HELIUS_API_KEY ?? '',
    anthropicApiKey: overrides.anthropicApiKey ?? env.ANTHROPIC_API_KEY ?? '',
    walletPrivateKey: overrides.walletPrivateKey ?? env.WALLET_PRIVATE_KEY ?? '',
    rpcUrl:
      overrides.rpcUrl ||
      env.RPC_URL ||
      (env.HELIUS_API_KEY
        ? `https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`
        : 'https://api.mainnet-beta.solana.com'),
    deleteOnKill: String(overrides.deleteOnKill ?? env.DELETE_ON_KILL ?? 'false') === 'true',
    rules: { ...DEFAULT_RULES, ...(overrides.rules || {}), filters: { ...DEFAULT_RULES.filters, ...(overrides.rules?.filters || {}) }, copytrade: { ...DEFAULT_RULES.copytrade, ...(overrides.rules?.copytrade || {}) } },
  };
}
