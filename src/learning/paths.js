import path from 'node:path';
import fs from 'node:fs';
import { appendJsonl, readJsonl, ensureDir, writeJson, readJson } from '../utils/store.js';

function pathsDir(dataDir) {
  return path.join(dataDir, 'paths');
}

function pathFile(dataDir, id) {
  return path.join(pathsDir(dataDir), `${id}.jsonl`);
}

function metaFile(dataDir, id) {
  return path.join(pathsDir(dataDir), `${id}.meta.json`);
}

export function startPath(dataDir, id, meta) {
  ensureDir(pathsDir(dataDir));
  writeJson(metaFile(dataDir, id), { ...meta, startedAt: Date.now() });
}

export function recordTick(dataDir, id, tick) {
  appendJsonl(pathFile(dataDir, id), { ts: Date.now(), ...tick });
}

export function readPath(dataDir, id) {
  return { meta: readJson(metaFile(dataDir, id), {}), ticks: readJsonl(pathFile(dataDir, id)) };
}

export function listPathIds(dataDir) {
  const dir = pathsDir(dataDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.meta.json'))
    .map((f) => f.replace('.meta.json', ''));
}

export function isPathExpired(dataDir, id, durationMs) {
  const { meta } = readPath(dataDir, id);
  if (!meta.startedAt) return true;
  return Date.now() - meta.startedAt >= durationMs;
}
