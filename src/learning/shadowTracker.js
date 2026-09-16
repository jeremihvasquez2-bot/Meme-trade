import path from 'node:path';
import { readJson, writeJson } from '../utils/store.js';
import { isPathExpired } from './paths.js';

function registryFile(dataDir) {
  return path.join(dataDir, 'paths', 'active_shadows.json');
}

// Shadow candidates need ticks recorded for hours after they're first seen,
// long after the scan cycle that discovered them has moved on. This registry
// is how later cycles know which path ids still need polling.
export function loadActiveShadows(dataDir) {
  return readJson(registryFile(dataDir), []);
}

export function saveActiveShadows(dataDir, list) {
  writeJson(registryFile(dataDir), list);
}

export function addShadow(dataDir, entry) {
  const list = loadActiveShadows(dataDir);
  list.push(entry);
  saveActiveShadows(dataDir, list);
  return list;
}

// Drops shadows whose recording window has elapsed and returns the rest.
export function pruneExpired(dataDir, durationMs) {
  const list = loadActiveShadows(dataDir);
  const active = list.filter((s) => !isPathExpired(dataDir, s.id, durationMs));
  saveActiveShadows(dataDir, active);
  return active;
}
