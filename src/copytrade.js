// Copy-trading. Not "follow the leaderboard" — the leaderboards are scalper
// bots we could never keep up with. Instead: who made money on the tokens we
// are already watching, vetted on their own trade history, then watched by
// their on-chain holdings.
import { cfg } from './config.js';
import { dataPath, readJson, writeJson } from './store.js';
import { log } from './log.js';
import * as tracker from './sources/solanatracker.js';
import * as rpc from './sources/rpc.js';
import { num, uniq, DAY } from './util.js';

export function walletsFile() {
  return dataPath('wallets.json');
}

export function loadWallets() {
  const saved = readJson(walletsFile(), null);
  return saved && typeof saved === 'object'
    ? { wallets: [], rejected: {}, lastDiscoveryAt: 0, ...saved }
    : { wallets: [], rejected: {}, lastDiscoveryAt: 0 };
}

export function saveWallets(book) {
  writeJson(walletsFile(), book);
  return book;
}

export function followed(book = loadWallets()) {
  return book.wallets.filter((w) => w.following !== false);
}

/** The ten busiest liquid tokens from the last scan — where the money was. */
export function discoveryTargets(candidates, limit = 10) {
  return candidates
    .filter((c) => num(c.liquidityUsd) >= cfg.MIN_LIQUIDITY_USD && num(c.volumeH1) > 0)
    .sort((a, b) => num(b.volumeH1) - num(a.volumeH1))
    .slice(0, limit)
    .map((c) => c.mint);
}

export function dueForDiscovery(book = loadWallets(), now = Date.now()) {
  return now - num(book.lastDiscoveryAt) >= DAY;
}

/**
 * Once a day. Each wallet costs one request to find and one to vet, so the
 * whole run is budgeted well inside the free tier's 2,500/month.
 */
export async function discover(candidates, { maxWallets = 12, now = Date.now() } = {}) {
  const book = loadWallets();
  if (!cfg.SOLANA_TRACKER_KEY) return { book, checked: 0, added: 0, skipped: 'no SOLANA_TRACKER_KEY' };

  const mints = discoveryTargets(candidates);
  const known = new Set([...book.wallets.map((w) => w.owner), ...Object.keys(book.rejected || {})]);
  const found = [];
  for (const mint of mints) {
    if (tracker.budgetRemaining() < 4) break;
    try {
      found.push(...(await tracker.topTraders(mint)));
    } catch (err) {
      log.debug(`top-traders ${mint}: ${err.message}`);
    }
  }

  const fresh = uniq(found).filter((owner) => owner && !known.has(owner)).slice(0, maxWallets);
  let added = 0;
  for (const owner of fresh) {
    if (tracker.budgetRemaining() < 2) break;
    try {
      const trips = tracker.roundTrips(await tracker.walletTrades(owner));
      const grade = tracker.gradeWallet(owner, trips);
      if (grade.ok) {
        book.wallets.push({ owner, grade, followedAt: now, following: true, holdings: {}, lastPollAt: 0 });
        added += 1;
        log.info(`following wallet ${owner}: ${grade.trips} trips, ${(grade.winRate * 100).toFixed(0)}% win`);
      } else {
        book.rejected[owner] = grade.reasons.join('; ');
      }
    } catch (err) {
      log.debug(`wallet ${owner}: ${err.message}`);
    }
  }

  book.lastDiscoveryAt = now;
  saveWallets(book);
  return { book, checked: fresh.length, added, budgetLeft: tracker.budgetRemaining() };
}

/** Follow a wallet by hand (the Wallets to follow list in Control.md). */
export function followManually(owner, now = Date.now()) {
  const book = loadWallets();
  if (book.wallets.some((w) => w.owner === owner)) return book;
  book.wallets.push({
    owner,
    grade: { owner, trips: 0, winRate: 0, medianHoldMs: 0, pnlUsd: 0, ok: true, reasons: ['added by hand'] },
    followedAt: now,
    following: true,
    manual: true,
    holdings: {},
    lastPollAt: 0,
  });
  return saveWallets(book);
}

export async function pollHoldings({ now = Date.now(), limit = 25 } = {}) {
  const book = loadWallets();
  const list = followed(book).slice(0, limit);
  for (const wallet of list) {
    try {
      const rows = await rpc.tokenBalances(wallet.owner);
      wallet.holdings = Object.fromEntries(rows.filter((r) => r.ui > 0).map((r) => [r.mint, r.ui]));
      wallet.lastPollAt = now;
    } catch (err) {
      log.debug(`holdings ${wallet.owner}: ${err.message}`);
    }
  }
  saveWallets(book);
  return book;
}

export function holdersOf(mint, book = loadWallets()) {
  return followed(book)
    .filter((w) => num(w.holdings?.[mint]) > 0)
    .map((w) => w.owner);
}

export function smartMoneyCount(mint, book = loadWallets()) {
  return holdersOf(mint, book).length;
}

/** Tokens at least SMART_MONEY_MIN_WALLETS followed wallets just bought. */
export function smartMoneyMints(book = loadWallets()) {
  const counts = new Map();
  for (const wallet of followed(book)) {
    for (const mint of Object.keys(wallet.holdings || {})) {
      counts.set(mint, (counts.get(mint) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= cfg.SMART_MONEY_MIN_WALLETS)
    .sort((a, b) => b[1] - a[1])
    .map(([mint, n]) => ({ mint, count: n }));
}

/**
 * If the wallets that were holding when we bought have mostly walked away,
 * the reason we bought is gone. Take the hint.
 */
export function followersLeft(position, book = loadWallets()) {
  const atEntry = position.followers || [];
  if (atEntry.length < cfg.SMART_MONEY_MIN_WALLETS) return false;
  const still = holdersOf(position.mint, book);
  const remaining = atEntry.filter((owner) => still.includes(owner)).length;
  return remaining / atEntry.length < 0.5;
}
