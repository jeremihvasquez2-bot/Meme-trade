import path from 'node:path';
import { readJson, writeJson } from '../utils/store.js';

function file(dataDir) {
  return path.join(dataDir, 'telegram.json');
}

const CODE_TTL_MS = 15 * 60 * 1000;

function randomCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function generatePairCode(dataDir) {
  const state = readJson(file(dataDir), {});
  state.pendingCode = randomCode();
  state.pendingExpiresAt = Date.now() + CODE_TTL_MS;
  writeJson(file(dataDir), state);
  return state.pendingCode;
}

export function getPairedChatId(dataDir) {
  return readJson(file(dataDir), {}).chatId ?? null;
}

// Called on `/start <code>` from Telegram. Returns true if the code matched.
export function attemptPair(dataDir, code, chatId) {
  const state = readJson(file(dataDir), {});
  if (!state.pendingCode || state.pendingCode !== String(code).trim()) return false;
  if (Date.now() > state.pendingExpiresAt) return false;
  state.chatId = chatId;
  delete state.pendingCode;
  delete state.pendingExpiresAt;
  writeJson(file(dataDir), state);
  return true;
}

export function isFromPairedChat(dataDir, chatId) {
  const paired = getPairedChatId(dataDir);
  return paired !== null && String(paired) === String(chatId);
}
