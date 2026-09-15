import fs from 'node:fs';
import path from 'node:path';
import { ensureDir } from '../utils/store.js';

function lockFile(dataDir) {
  return path.join(dataDir, 'memebot.pid');
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Single-instance lock so two copies of the bot can never share one bankroll.
// Throws if another live instance already holds the lock.
export function acquireLock(dataDir) {
  ensureDir(dataDir);
  const file = lockFile(dataDir);
  if (fs.existsSync(file)) {
    const existingPid = Number(fs.readFileSync(file, 'utf8').trim());
    if (existingPid && isPidAlive(existingPid)) {
      throw new Error(`memebot is already running (pid ${existingPid}); refusing to start a second instance against the same bankroll`);
    }
  }
  fs.writeFileSync(file, String(process.pid));
  process.on('exit', () => releaseLock(dataDir));
}

export function releaseLock(dataDir) {
  try {
    const file = lockFile(dataDir);
    if (fs.existsSync(file) && Number(fs.readFileSync(file, 'utf8').trim()) === process.pid) {
      fs.unlinkSync(file);
    }
  } catch {
    // best effort
  }
}
