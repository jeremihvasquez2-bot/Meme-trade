// A single-instance lock. Two copies sharing one bankroll would each think
// they had the whole thing, and you would find out the expensive way.
import fs from 'node:fs';
import { dataPath, ensureDir, readJson, writeJson } from './store.js';
import path from 'node:path';

export function lockFile() {
  return dataPath('memebot.pid');
}

export function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

export function acquireLock({ pid = process.pid, now = Date.now() } = {}) {
  const file = lockFile();
  ensureDir(path.dirname(file));
  const existing = readJson(file, null);
  if (existing?.pid && existing.pid !== pid && isRunning(existing.pid)) {
    return { ok: false, holder: existing };
  }
  writeJson(file, { pid, startedAt: now, host: process.env.COMPUTERNAME || process.env.HOSTNAME || '' });
  return { ok: true, holder: null };
}

export function releaseLock({ pid = process.pid } = {}) {
  const existing = readJson(lockFile(), null);
  if (!existing || existing.pid === pid) {
    try {
      fs.unlinkSync(lockFile());
    } catch {
      /* already gone */
    }
  }
}
