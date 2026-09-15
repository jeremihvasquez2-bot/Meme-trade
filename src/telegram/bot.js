import path from 'node:path';
import { fetchJson } from '../utils/http.js';
import { readJson, writeJson } from '../utils/store.js';
import { attemptPair, isFromPairedChat, getPairedChatId } from './pairing.js';
import { parseCommand, buildReply } from './commands.js';
import { matchKeywordAnswer } from './qa.js';

function offsetFile(dataDir) {
  return path.join(dataDir, 'telegram_offset.json');
}

export async function sendMessage(config, text, chatId) {
  const target = chatId ?? getPairedChatId(config.dataDir);
  if (!config.telegramToken || !target) return;
  try {
    await fetch(`https://api.telegram.org/bot${config.telegramToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: target, text }),
    });
  } catch {
    // best effort; the next notification will retry
  }
}

// `handlers`: { buildCommandContext(), buildQaContext(), onAction(action), onFreeText(text, ctx) }
export async function pollOnce(config, handlers) {
  if (!config.telegramToken) return;
  const offsetState = readJson(offsetFile(config.dataDir), { offset: 0 });
  const data = await fetchJson(
    `https://api.telegram.org/bot${config.telegramToken}/getUpdates?timeout=25&offset=${offsetState.offset}`,
    { timeoutMs: 30_000, retries: 0 },
  );

  for (const update of data.result || []) {
    offsetState.offset = update.update_id + 1;
    const msg = update.message;
    if (!msg?.text) continue;
    const chatId = msg.chat.id;
    const text = msg.text.trim();

    const startMatch = text.match(/^\/start\s+(\d+)/);
    if (startMatch) {
      const ok = attemptPair(config.dataDir, startMatch[1], chatId);
      await sendMessage(config, ok ? 'Paired. This chat now controls the bot.' : 'Invalid or expired code. Run `npm run status` for a new one.', chatId);
      continue;
    }

    if (!isFromPairedChat(config.dataDir, chatId)) {
      await sendMessage(config, "This bot is paired to a different chat. Run `npm run status` on the bot's machine for a pairing code.", chatId);
      continue;
    }

    const parsed = parseCommand(text);
    if (parsed) {
      const ctx = await handlers.buildCommandContext();
      const { reply, action } = buildReply(parsed.command, parsed.args, ctx);
      if (action) await handlers.onAction(action);
      await sendMessage(config, reply, chatId);
    } else {
      const ctx = await handlers.buildQaContext();
      const answer =
        matchKeywordAnswer(text, ctx) ??
        (await handlers.onFreeText?.(text, ctx)) ??
        "No canned answer for that. Try /status, /positions, /money, or ask about rounds, holdings, lessons, or readiness.";
      await sendMessage(config, answer, chatId);
    }
  }

  writeJson(offsetFile(config.dataDir), offsetState);
}

export async function pollLoop(config, handlers, { signal } = {}) {
  while (!signal?.aborted) {
    try {
      await pollOnce(config, handlers);
    } catch (err) {
      handlers.onError?.(err);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}
