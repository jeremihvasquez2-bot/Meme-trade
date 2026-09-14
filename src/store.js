// Every byte the bot remembers lives under DATA_DIR as plain JSON / JSONL so
// you can read it with a text editor when you do not believe the bot.
import fs from 'node:fs';
import path from 'node:path';
import { cfg } from './config.js';

export function dataPath(...parts) {
  return path.join(cfg.DATA_DIR, ...parts);
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/** Write via a temp file + rename so a crash mid-write cannot corrupt state. */
export function writeJson(file, value) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

export function appendJsonl(file, value) {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`);
}

export function readJsonl(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // a half-written last line after a crash; skip it
    }
  }
  return out;
}

export function appendText(file, text) {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, text);
}

export function listFiles(dir, ext) {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => !ext || f.endsWith(ext))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}
