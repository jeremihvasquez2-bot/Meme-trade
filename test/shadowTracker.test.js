import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { addShadow, loadActiveShadows, pruneExpired } from '../src/learning/shadowTracker.js';
import { startPath } from '../src/learning/paths.js';
import { tmpConfig } from './helpers.js';

test('addShadow appends to the registry and loadActiveShadows reads it back', () => {
  const config = tmpConfig();
  addShadow(config.dataDir, { id: 'shadow-A', mint: 'A' });
  addShadow(config.dataDir, { id: 'shadow-B', mint: 'B' });
  const list = loadActiveShadows(config.dataDir);
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((s) => s.mint), ['A', 'B']);
});

test('pruneExpired drops shadows past their recording window and keeps the rest', () => {
  const config = tmpConfig();
  startPath(config.dataDir, 'shadow-old', { mint: 'OLD' });
  startPath(config.dataDir, 'shadow-fresh', { mint: 'FRESH' });
  addShadow(config.dataDir, { id: 'shadow-old', mint: 'OLD' });
  addShadow(config.dataDir, { id: 'shadow-fresh', mint: 'FRESH' });

  // Backdate the "old" shadow's start time past the pruning window.
  const metaFile = path.join(config.dataDir, 'paths', 'shadow-old.meta.json');
  const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  meta.startedAt = Date.now() - 10_000;
  fs.writeFileSync(metaFile, JSON.stringify(meta));

  const active = pruneExpired(config.dataDir, 5_000);
  assert.deepEqual(active.map((s) => s.mint), ['FRESH']);
  assert.deepEqual(loadActiveShadows(config.dataDir).map((s) => s.mint), ['FRESH']);
});
