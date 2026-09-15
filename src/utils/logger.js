import fs from 'node:fs';
import path from 'node:path';
import { ensureDir } from './store.js';

export function createLogger(dataDir) {
  const logFile = path.join(dataDir, 'bot.log');
  ensureDir(dataDir);

  function write(level, msg, meta) {
    const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${msg}${meta ? ` ${JSON.stringify(meta)}` : ''}`;
    try {
      fs.appendFileSync(logFile, `${line}\n`);
    } catch {
      // best effort
    }
    if (level === 'error') console.error(line);
    else console.log(line);
  }

  return {
    info: (msg, meta) => write('info', msg, meta),
    warn: (msg, meta) => write('warn', msg, meta),
    error: (msg, meta) => write('error', msg, meta),
  };
}
