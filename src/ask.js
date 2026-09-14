// Optional: plain-language questions answered by Claude, given ONLY a summary
// of the bot's own numbers. No keys, no config, no control — it can describe
// what happened, it cannot make anything happen.
import { cfg } from './config.js';
import { httpJson } from './http.js';
import { loadTrades } from './positions.js';
import { tally } from './money.js';
import { num, signedUsd } from './util.js';

export const MODEL = 'claude-sonnet-5';

export function buildContext(state, positions) {
  const t = tally(state, positions);
  const trades = loadTrades().slice(-25);
  return [
    `mode=${cfg.MODE} wallet=$${t.wallet} bankroll=$${t.bankroll} cash=$${t.cash} inTrades=$${t.inTrades}`,
    `made=$${t.madeUsd} lost=$${t.lostUsd} net=$${t.netUsd} fees=$${t.feesUsd} wins=${t.wins} losses=${t.losses}`,
    `round=${t.round} target=$${t.target} roundsWon=${t.roundsWon} roundsLost=${t.roundsLost}`,
    `open: ${positions.map((p) => `${p.symbol} ${num(p.lastPriceUsd) / num(p.entryPriceUsd || 1)}x`).join(', ') || 'none'}`,
    'recent trades:',
    ...trades.map(
      (tr) => `  ${tr.symbol} ${tr.outcome} ${signedUsd(tr.pnlUsd)} peak ${tr.peakMultiple}x reason ${tr.reason}`,
    ),
  ].join('\n');
}

export async function ask(question, context) {
  if (!cfg.ANTHROPIC_API_KEY) return null;
  try {
    const res = await httpJson('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      timeoutMs: 30000,
      tries: 1,
      headers: {
        'x-api-key': cfg.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: {
        model: MODEL,
        max_tokens: 400,
        system:
          'You are the voice of a Solana meme-coin trading bot talking to its owner on Telegram. ' +
          'Answer only from the DATA block. Be short, plain and honest; never promise profit; ' +
          'if the data does not say, say you do not know. No markdown headings.',
        messages: [{ role: 'user', content: `DATA:\n${context}\n\nQUESTION: ${question}` }],
      },
    });
    const text = (res?.content || []).map((c) => c.text || '').join('').trim();
    return text || null;
  } catch {
    return null;
  }
}
