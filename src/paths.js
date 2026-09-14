// The recorder. Every open position AND every candidate that passed safety
// gets its real price path written down, one tick per 15s, with the features
// it had at entry. This is the only asset the bot builds that compounds: you
// can change the rules tomorrow and re-run them over what actually happened.
import { cfg } from './config.js';
import { dataPath, readJson, writeJson, appendJsonl, readJsonl, listFiles } from './store.js';
import { num, round, id, HOUR } from './util.js';
import path from 'node:path';

export function pathsDir() {
  return dataPath('paths');
}
export function indexFile() {
  return path.join(pathsDir(), 'index.json');
}
export function pathFile(pathId) {
  return path.join(pathsDir(), `${pathId}.jsonl`);
}

export function loadIndex() {
  const idx = readJson(indexFile(), {});
  return idx && typeof idx === 'object' ? idx : {};
}

export function saveIndex(index) {
  writeJson(indexFile(), index);
  return index;
}

export function startPath({ mint, symbol, kind, entryPriceUsd, features, score, positionId = null }) {
  const index = loadIndex();
  const pathId = id(kind === 'position' ? 'p' : 's');
  index[pathId] = {
    id: pathId,
    kind,
    mint,
    symbol,
    positionId,
    score: num(score),
    entryPriceUsd: num(entryPriceUsd),
    features: features || {},
    startedAt: Date.now(),
    expiresAt: Date.now() + cfg.SHADOW_PATH_HOURS * HOUR,
    closed: false,
    ticks: 0,
  };
  saveIndex(index);
  return index[pathId];
}

export function recordTick(pathId, tick) {
  const index = loadIndex();
  const meta = index[pathId];
  if (!meta || meta.closed) return null;
  const row = {
    t: Date.now(),
    price: num(tick.priceUsd),
    m5: num(tick.m5),
    buys: num(tick.buysM5),
    sells: num(tick.sellsM5),
    vol5m: num(tick.volumeM5),
  };
  appendJsonl(pathFile(pathId), row);
  meta.ticks += 1;
  meta.lastPriceUsd = row.price;
  meta.lastTickAt = row.t;
  saveIndex(index);
  return row;
}

export function closePath(pathId, outcome = 'expired') {
  const index = loadIndex();
  const meta = index[pathId];
  if (!meta) return null;
  meta.closed = true;
  meta.outcome = outcome;
  meta.closedAt = Date.now();
  saveIndex(index);
  return meta;
}

export function expirePaths(now = Date.now()) {
  const index = loadIndex();
  let changed = 0;
  for (const meta of Object.values(index)) {
    if (!meta.closed && num(meta.expiresAt) <= now) {
      meta.closed = true;
      meta.outcome = 'expired';
      meta.closedAt = now;
      changed += 1;
    }
  }
  if (changed) saveIndex(index);
  return changed;
}

export function openPaths(now = Date.now()) {
  return Object.values(loadIndex()).filter((m) => !m.closed && num(m.expiresAt) > now);
}

export function readTicks(pathId) {
  return readJsonl(pathFile(pathId));
}

/** All recorded paths with their ticks. The input to replay and entries. */
export function loadPaths({ minTicks = 2, kind = null } = {}) {
  const index = loadIndex();
  const out = [];
  for (const meta of Object.values(index)) {
    if (kind && meta.kind !== kind) continue;
    const ticks = readTicks(meta.id);
    if (ticks.length < minTicks) continue;
    out.push({ ...meta, ticks });
  }
  return out.sort((a, b) => a.startedAt - b.startedAt);
}

export function pathStats(p) {
  const prices = p.ticks.map((t) => t.price).filter((v) => v > 0);
  const entry = num(p.entryPriceUsd) || prices[0] || 0;
  const peak = prices.length ? Math.max(...prices) : entry;
  const low = prices.length ? Math.min(...prices) : entry;
  const last = prices.length ? prices[prices.length - 1] : entry;
  return {
    entry,
    peak,
    low,
    last,
    peakMultiple: entry ? round(peak / entry, 3) : 0,
    drawdown: entry ? round((low / entry - 1) * 100, 2) : 0,
    endPct: entry ? round((last / entry - 1) * 100, 2) : 0,
    durationMs: p.ticks.length ? p.ticks[p.ticks.length - 1].t - p.ticks[0].t : 0,
  };
}

export function countPaths() {
  return listFiles(pathsDir(), '.jsonl').length;
}
