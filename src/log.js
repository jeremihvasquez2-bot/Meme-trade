import path from 'node:path';
import { dataPath, appendText, ensureDir } from './store.js';
import { dayKey } from './util.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
let minLevel = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;
let toConsole = process.env.LOG_QUIET !== '1';

export function setLogLevel(level) {
  minLevel = LEVELS[level] ?? minLevel;
}
export function setLogConsole(on) {
  toConsole = !!on;
}

function write(level, msg, extra) {
  if ((LEVELS[level] ?? 20) < minLevel) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${msg}${
    extra === undefined ? '' : ` ${safe(extra)}`
  }`;
  if (toConsole) console.log(line);
  try {
    appendText(dataPath('logs', `${dayKey()}.log`), `${line}\n`);
  } catch {
    // logging must never take the bot down
  }
}

function safe(value) {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export const log = {
  debug: (m, e) => write('debug', m, e),
  info: (m, e) => write('info', m, e),
  warn: (m, e) => write('warn', m, e),
  error: (m, e) => write('error', m, e),
};

/** Crashes get their own file so a restart loop leaves a trail. */
export function logCrash(err, where = 'unknown') {
  const file = dataPath('logs', 'crashes.log');
  const body = `${new Date().toISOString()} [${where}] ${err?.stack || err}\n`;
  try {
    ensureDir(path.dirname(file));
    appendText(file, body);
  } catch {
    /* ignore */
  }
  if (toConsole) console.error(body);
}
