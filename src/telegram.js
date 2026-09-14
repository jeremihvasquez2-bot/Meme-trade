// Telegram. Long polling, no webhook, no port to open. Pairing is a one-time
// code shown by `npm run status`: whoever sends it first owns the bot, and
// every other chat is ignored forever after.
import { cfg } from './config.js';
import { dataPath, readJson, writeJson } from './store.js';
import { log } from './log.js';
import { httpJson } from './http.js';
import { num, sleep, usd, signedUsd, humanDuration, shortMint } from './util.js';

export function pairingFile() {
  return dataPath('telegram.json');
}

export function loadPairing() {
  return readJson(pairingFile(), { code: null, chatId: null, pairedAt: 0, offset: 0 });
}

export function savePairing(value) {
  writeJson(pairingFile(), value);
  return value;
}

export function newPairingCode() {
  const pairing = loadPairing();
  // Keep showing the same code until it is actually used, so the number on
  // the screen and the number in your head stay the same.
  if (pairing.chatId || pairing.code) return pairing;
  pairing.code = String(Math.floor(100000 + Math.random() * 900000));
  return savePairing(pairing);
}

export function isPaired() {
  return !!loadPairing().chatId;
}

/**
 * Pairing. `/start <code>` from any chat, once, matching the code shown by
 * `npm run status`. After that only that chat can command it.
 */
export function tryPair(chatId, text) {
  const pairing = loadPairing();
  if (pairing.chatId) {
    return pairing.chatId === chatId
      ? { ok: true, already: true, reply: 'Already paired with this chat.' }
      : { ok: false, reply: null };
  }
  const code = String(text || '').trim().split(/\s+/)[1];
  if (!pairing.code) return { ok: false, reply: 'No pairing code has been generated. Run: npm run status' };
  if (code !== pairing.code) return { ok: false, reply: 'Wrong code. Run `npm run status` on the PC to see it.' };
  pairing.chatId = chatId;
  pairing.pairedAt = Date.now();
  pairing.code = null;
  savePairing(pairing);
  return { ok: true, reply: "Paired. This chat now owns the bot.\nTry /status." };
}

export function unpair() {
  const pairing = loadPairing();
  pairing.chatId = null;
  pairing.pairedAt = 0;
  return savePairing(pairing);
}

const HELP = `Commands:
/status — where the money is
/positions — what I am holding
/money — the full tally
/pause — stop opening new trades (open ones still exit)
/resume — start again
/stop confirm — sell everything and halt
/proposals — changes waiting on you
/approve N — apply proposal N (I re-run my tests first)
/reject N — bin proposal N

Or just ask: "how much have you made", "what are you holding", "are you ready",
"why did you sell PEPE", "what have you learned", "run the sims".`;

/**
 * Built-in keyword answers, so the bot is useful with no AI key at all.
 * Returns null when nothing matches and the caller should fall back.
 */
export function keywordAnswer(text, api) {
  const q = String(text || '').toLowerCase();
  const has = (...words) => words.every((w) => q.includes(w));
  const any = (...words) => words.some((w) => q.includes(w));

  if (any('help', 'commands', 'what can you do')) return HELP;
  if (has('why') && any('sell', 'sold')) {
    const m = String(text).match(/(?:sell|sold)\s+\$?([A-Za-z0-9]{2,15})/i);
    return api.whySold(m ? m[1] : null);
  }
  if (any('ready', 'readiness', 'go live', 'real money')) return api.readiness();
  if (any('lesson', 'learned', 'learnt')) return api.lessons();
  if (any('sim', 'monte carlo', 'odds', 'chance')) return api.sims();
  if (any('round', 'scoreboard')) return api.rounds();
  if (any('holding', 'position', 'open trade', 'bags')) return api.positions();
  if (any('made', 'lost', 'profit', 'pnl', 'p&l', 'money', 'up or down', 'winning')) return api.money();
  if (any('status', 'how are you', 'alive', 'working')) return api.status();
  if (any('pause', 'stop buying')) return api.pause();
  if (any('resume', 'start again', 'unpause')) return api.resume();
  return null;
}

/** Route one incoming message. Pure-ish: everything it needs is on `api`. */
export function handleMessage({ chatId, text }, api) {
  const body = String(text || '').trim();
  if (/^\/start\b/.test(body)) return tryPair(chatId, body).reply;

  const pairing = loadPairing();
  if (!pairing.chatId) return 'Not paired yet. Run `npm run status` on the PC and send me /start <code>.';
  if (pairing.chatId !== chatId) return null; // silence for everyone else

  const [rawCmd, ...args] = body.split(/\s+/);
  const cmd = rawCmd.toLowerCase();
  switch (cmd) {
    case '/status':
      return api.status();
    case '/positions':
      return api.positions();
    case '/money':
      return api.money();
    case '/pause':
      return api.pause();
    case '/resume':
      return api.resume();
    case '/stop':
      return args[0] === 'confirm'
        ? api.stop()
        : 'That sells everything and halts me. Send `/stop confirm` if you mean it.';
    case '/proposals':
      return api.proposals();
    case '/approve':
      return api.approve(num(args[0], NaN));
    case '/reject':
      return api.reject(num(args[0], NaN));
    case '/help':
      return HELP;
    default:
      if (cmd.startsWith('/')) return `I do not know ${cmd}.\n\n${HELP}`;
      return keywordAnswer(body, api) || api.fallback(body) || HELP;
  }
}

export function formatPositions(positions) {
  if (!positions.length) return 'Holding nothing right now.';
  return positions
    .map((p) => {
      const multiple = num(p.lastPriceUsd) / num(p.entryPriceUsd || 1);
      const valueUsd = num(p.costUsd) * multiple;
      return (
        `${multiple >= 1 ? '🟢' : '🔴'} ${p.symbol} ${shortMint(p.mint)}\n` +
        `   ${usd(p.costUsd)} in → ${usd(valueUsd)} now (${multiple.toFixed(2)}x) · ${humanDuration(Date.now() - p.openedAt)} · score ${p.score}`
      );
    })
    .join('\n');
}

export function formatSellAlert(trade, sale) {
  const flag = trade.outcome === 'WIN' ? '🟢 WIN' : '🔴 LOSE';
  return [
    `${flag} sold ${trade.symbol} — ${sale.reason.replace(/_/g, ' ')}`,
    `This sale: ${usd(sale.proceedsUsd)} for ${(num(sale.fraction) * 100).toFixed(0)}% of the bag`,
    `Whole trade: ${usd(trade.costUsd)} in → ${usd(trade.proceedsUsd)} out = ${signedUsd(trade.pnlUsd)} (${trade.pnlPct}%)`,
    `Peak was ${trade.peakMultiple}x · held ${humanDuration(trade.holdMs)}`,
  ].join('\n');
}

// --- the wire ------------------------------------------------------------

export function createClient(token = cfg.TELEGRAM_BOT_TOKEN) {
  const base = `https://api.telegram.org/bot${token}`;
  return {
    enabled: !!token,
    async send(chatId, text) {
      if (!token || !chatId) return null;
      return httpJson(`${base}/sendMessage`, {
        method: 'POST',
        tries: 2,
        body: { chat_id: chatId, text: String(text).slice(0, 4000), disable_web_page_preview: true },
      }).catch((err) => {
        log.warn(`telegram send failed: ${err.message}`);
        return null;
      });
    },
    async updates(offset) {
      return httpJson(`${base}/getUpdates?offset=${offset}&timeout=25`, { timeoutMs: 30000, tries: 1 });
    },
  };
}

/** The long-polling loop. Runs until `stop()` is called. */
export function startPolling(api, { client = createClient(), intervalMs = 1000 } = {}) {
  if (!client.enabled) {
    log.warn('TELEGRAM_BOT_TOKEN not set — running without Telegram');
    return { stop() {} };
  }
  let running = true;
  (async () => {
    while (running) {
      try {
        const pairing = loadPairing();
        const res = await client.updates(num(pairing.offset) + 1);
        for (const update of res?.result || []) {
          pairing.offset = Math.max(num(pairing.offset), num(update.update_id));
          savePairing({ ...loadPairing(), offset: pairing.offset });
          const message = update.message || update.edited_message;
          if (!message?.text) continue;
          const reply = await handleMessage({ chatId: message.chat.id, text: message.text }, api);
          if (reply) await client.send(message.chat.id, reply);
        }
      } catch (err) {
        log.debug(`telegram poll: ${err.message}`);
        await sleep(3000);
      }
      await sleep(intervalMs);
    }
  })();
  return {
    stop() {
      running = false;
    },
  };
}
