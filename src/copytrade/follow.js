import path from 'node:path';
import { readJson, writeJson } from '../utils/store.js';
import { getTopTraders, getWalletTrades } from '../research/solanaTracker.js';
import { getWalletHoldings } from '../research/rpc.js';
import { qualifyWallet } from './wallets.js';

function followedFile(dataDir) {
  return path.join(dataDir, 'followed_wallets.json');
}

function holdingsFile(dataDir) {
  return path.join(dataDir, 'wallet_holdings.json');
}

export function loadFollowed(dataDir) {
  return readJson(followedFile(dataDir), {});
}

export function saveFollowed(dataDir, followed) {
  writeJson(followedFile(dataDir), followed);
}

// Once a day: for the top-volume tokens from the latest scan, pull their top
// traders and keep only wallets that clear the round-trip/hold/win-rate bar.
export async function discoverWallets(config, topMints) {
  const followed = loadFollowed(config.dataDir);
  const candidateAddresses = new Set();

  for (const mint of topMints.slice(0, config.rules.copytrade.topTokensPerDay)) {
    const traders = await getTopTraders(config, mint);
    for (const t of traders) {
      const addr = t.wallet ?? t.address ?? t.owner;
      if (addr) candidateAddresses.add(addr);
    }
  }

  const newlyFollowed = [];
  for (const addr of candidateAddresses) {
    if (followed[addr]) continue;
    const trades = await getWalletTrades(config, addr);
    const stats = qualifyWallet(trades, config.rules.copytrade);
    if (stats) {
      followed[addr] = { ...stats, followedSince: new Date().toISOString() };
      newlyFollowed.push({ address: addr, stats });
    }
  }

  saveFollowed(config.dataDir, followed);
  return newlyFollowed;
}

// Polls followed wallets' current SPL holdings and reports which mints are
// newly held (not in the previous snapshot) by >= minFollowedHoldersForBoost
// followed wallets, so those candidates can jump the research queue.
export async function pollHoldings(config) {
  const followed = loadFollowed(config.dataDir);
  const addresses = Object.keys(followed);
  const prevSnapshot = readJson(holdingsFile(config.dataDir), {});
  const nextSnapshot = {};
  const holderCounts = new Map();

  for (const addr of addresses) {
    const holdings = await getWalletHoldings(config, addr);
    const mints = holdings.map((h) => h.mint);
    nextSnapshot[addr] = mints;
    for (const mint of mints) holderCounts.set(mint, (holderCounts.get(mint) || 0) + 1);
  }

  const prevMintSets = new Map();
  for (const addr of addresses) {
    for (const mint of prevSnapshot[addr] || []) {
      if (!prevMintSets.has(mint)) prevMintSets.set(mint, new Set());
      prevMintSets.get(mint).add(addr);
    }
  }

  const boosted = [];
  for (const [mint, count] of holderCounts) {
    if (count < config.rules.copytrade.minFollowedHoldersForBoost) continue;
    const wasHeld = (prevMintSets.get(mint)?.size ?? 0) >= config.rules.copytrade.minFollowedHoldersForBoost;
    if (!wasHeld) boosted.push({ mint, holderCount: count });
  }

  writeJson(holdingsFile(config.dataDir), nextSnapshot);
  return boosted;
}

// True if the wallets that held `mint` at entry have mostly left it now.
export function shouldExitOnWalletDeparture(mint, entryHolders, currentSnapshot) {
  if (!entryHolders.length) return false;
  const stillHolding = entryHolders.filter((addr) => (currentSnapshot[addr] || []).includes(mint));
  return stillHolding.length / entryHolders.length < 0.5;
}
