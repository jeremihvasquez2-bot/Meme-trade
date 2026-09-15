// The Obsidian brain. Markdown, not a database — so you can read what the bot
// thinks on your phone, and steer it by ticking a box in Control.md.
import fs from 'node:fs';
import path from 'node:path';
import { cfg } from './config.js';
import { ensureDir, appendText } from './store.js';
import { humanDuration, num, round, signedUsd, usd, dayKey, shortMint } from './util.js';
import { tally } from './money.js';
import { riskSummary } from './risk.js';

export function brainDir() {
  return cfg.BRAIN_DIR;
}
const p = (...parts) => path.join(brainDir(), ...parts);

export function ensureBrain() {
  for (const dir of ['', 'Journal', 'Tokens', 'Wallets']) ensureDir(p(dir));
  if (!fs.existsSync(p('Control.md'))) fs.writeFileSync(p('Control.md'), CONTROL_TEMPLATE);
  if (!fs.existsSync(p('Lessons.md'))) fs.writeFileSync(p('Lessons.md'), '# Lessons\n\nWhat the trades taught, one line each.\n\n');
  return brainDir();
}

export const CONTROL_TEMPLATE = `# Control

The bot reads this file on every scan. Change it here, no restart needed.

- [ ] pause trading

## Never buy

List one mint address per line under this heading and it will never be bought.

## Wallets to follow

List one wallet address per line to follow it by hand.

## Approve proposals

Tick a proposal to approve it. The bot re-runs its own tests before applying.
`;

function section(text, heading) {
  const lines = String(text).split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim().toLowerCase() === `## ${heading.toLowerCase()}`);
  if (start < 0) return [];
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) break;
    out.push(lines[i]);
  }
  return out;
}

function bullets(lines) {
  return lines
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- '))
    .map((l) => l.slice(2).trim())
    .filter((l) => l && !l.startsWith('[') && l.length >= 32 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(l));
}

/** Pure so the test suite can throw malformed Control notes at it. */
export function parseControl(text) {
  const body = String(text || '');
  const pause = /-\s*\[[xX]\]\s*pause trading/.test(body);
  const approve = [];
  for (const line of section(body, 'Approve proposals')) {
    const m = line.match(/-\s*\[[xX]\]\s*#?(\d+)/);
    if (m) approve.push(Number(m[1]));
  }
  return {
    pause,
    neverBuy: bullets(section(body, 'Never buy')),
    follow: bullets(section(body, 'Wallets to follow')),
    approve,
  };
}

export function readControl() {
  try {
    return parseControl(fs.readFileSync(p('Control.md'), 'utf8'));
  } catch {
    return { pause: false, neverBuy: [], follow: [], approve: [] };
  }
}

/** Tick the box back off once a proposal has been dealt with. */
export function untickProposal(n) {
  const file = p('Control.md');
  try {
    const text = fs.readFileSync(file, 'utf8');
    const next = text.replace(new RegExp(`(-\\s*\\[)[xX](\\]\\s*#?${n}\\b)`, 'g'), '$1 $2');
    if (next !== text) fs.writeFileSync(file, next);
  } catch {
    /* no Control note yet */
  }
}

export function statusBlock(state, positions, extra = {}) {
  const t = tally(state, positions);
  const risk = riskSummary(state, positions);
  const lines = [
    `> [!info] MEMEBOT — ${cfg.MODE.toUpperCase()}${state.paused ? ' (paused)' : ''}${state.halted ? ' (HALTED)' : ''}`,
    `> Wallet **${usd(t.wallet)}** of ${usd(t.bankroll)} · ${usd(t.inTrades)} in ${t.open} open`,
    `> Round ${t.round} → ${usd(t.target)} · rounds won ${t.roundsWon} – lost ${t.roundsLost}`,
    `> Made ${usd(t.madeUsd)} · lost ${usd(t.lostUsd)} · net **${signedUsd(t.netUsd)}** · fees ${usd(t.feesUsd)}`,
    `> Record ${t.wins} WIN – ${t.losses} LOSE over ${t.trades} trades`,
    `> Next bet ${usd(risk.nextSize)} · day loss ${usd(risk.dayLoss)} of ${usd(risk.dayCap)}`,
    `> Updated ${new Date().toISOString().replace('T', ' ').slice(0, 16)}`,
  ];
  if (extra.readiness) lines.push(`> Readiness: **${extra.readiness}**`);
  return lines.join('\n');
}

export function writeHome(state, positions, extra = {}) {
  ensureBrain();
  const t = tally(state, positions);
  const rows = positions.length
    ? positions
        .map(
          (pos) =>
            `| ${pos.symbol} | ${usd(pos.costUsd)} | ${round(num(pos.lastPriceUsd) / num(pos.entryPriceUsd || 1), 2)}x | ${humanDuration(
              Date.now() - pos.openedAt,
            )} |`,
        )
        .join('\n')
    : '| — | | | |';
  const body = `# MEMEBOT

${statusBlock(state, positions, extra)}

## Open positions

| Token | Cost | Now | Held |
|---|---|---|---|
${rows}

## Where to look

- [[Control]] — steer it: pause, never-buy list, wallets, approve proposals
- [[Rules]] — the rules it is trading right now, and every change ever made
- [[Lessons]] — what the trades taught
- [[Proposals]] — changes waiting on you
- Journal/${dayKey()} — today, as it happened
- Tokens/ — one note per token traded
- Wallets/ — one note per wallet followed

*Paper results are the ceiling, not the floor. ${t.trades} trades so far.*
`;
  fs.writeFileSync(p('MEMEBOT.md'), body);
  return p('MEMEBOT.md');
}

export function journal(line) {
  ensureBrain();
  const stamp = new Date().toISOString().slice(11, 16);
  appendText(p('Journal', `${dayKey()}.md`), `- **${stamp}** ${line}\n`);
}

export function tokenNote(trade, { why = '', safety = {}, timeline = [], lesson = '' } = {}) {
  ensureBrain();
  const file = p('Tokens', `${(trade.symbol || 'TOKEN').replace(/[^\w-]/g, '')}-${String(trade.mint).slice(0, 6)}.md`);
  const body = `---
mint: ${trade.mint}
symbol: ${trade.symbol}
pnl: ${round(num(trade.pnlUsd), 2)}
pnl_pct: ${round(num(trade.pnlPct), 2)}
peak_multiple: ${num(trade.peakMultiple)}
hold: ${humanDuration(trade.holdMs)}
outcome: ${trade.outcome}
reason: ${trade.reason}
opened: ${new Date(trade.openedAt).toISOString()}
closed: ${new Date(trade.closedAt).toISOString()}
---

# ${trade.symbol} — ${trade.outcome} ${signedUsd(trade.pnlUsd)}

## Why I bought it

${why || `Score ${num(trade.score)} passed the threshold.`}

## Safety at entry

${Object.entries(safety)
  .map(([k, v]) => `- ${k}: ${v}`)
  .join('\n') || '- (not recorded)'}

## Timeline

${timeline.map((t) => `- ${t}`).join('\n') || '- (no events recorded)'}

## Lesson

${lesson}
`;
  fs.writeFileSync(file, body);
  return file;
}

export function walletNote(grade) {
  ensureBrain();
  const file = p('Wallets', `${String(grade.owner).slice(0, 8)}.md`);
  const body = `---
wallet: ${grade.owner}
round_trips: ${grade.trips}
win_rate: ${round(grade.winRate * 100, 1)}
median_hold: ${humanDuration(grade.medianHoldMs)}
pnl_usd: ${round(grade.pnlUsd, 2)}
following: ${grade.ok}
---

# Wallet ${shortMint(grade.owner)}

- Round trips: **${grade.trips}**
- Win rate: **${round(grade.winRate * 100, 1)}%**
- Median hold: **${humanDuration(grade.medianHoldMs)}**
- Their P&L over those trips: ${signedUsd(grade.pnlUsd)}
- Following: ${grade.ok ? 'yes' : `no — ${grade.reasons.join('; ')}`}
`;
  fs.writeFileSync(file, body);
  return file;
}

export function lesson(line) {
  ensureBrain();
  appendText(p('Lessons.md'), `- ${dayKey()} — ${line}\n`);
}

export function writeRules(history = []) {
  ensureBrain();
  const tunable = Object.keys(cfg.DEFAULTS)
    .filter((k) => typeof cfg[k] !== 'object')
    .sort()
    .map((k) => `| ${k} | ${cfg[k]} | ${cfg.DEFAULTS[k]} |`)
    .join('\n');
  const changes = history.length
    ? history
        .map(
          (h) =>
            `- ${new Date(h.at).toISOString().slice(0, 16).replace('T', ' ')} — #${h.n} ${h.title}: ` +
            Object.entries(h.changes)
              .map(([k, c]) => `${k} ${c.from} → ${c.to}`)
              .join(', '),
        )
        .join('\n')
    : '- (no changes yet)';
  fs.writeFileSync(
    p('Rules.md'),
    `# Rules

These are the rules the bot is trading **right now**.

| Setting | Now | Default |
|---|---|---|
${tunable}

## Tune history

${changes}
`,
  );
}

export function writeProposals(list) {
  ensureBrain();
  const body = list.length
    ? list
        .map((pr) => {
          const changes = Object.entries(pr.changes)
            .map(([k, c]) => `  - \`${k}\`: ${c.from} → **${c.to}**`)
            .join('\n');
          const box = pr.status === 'pending' ? '- [ ] ' : '- ';
          return `${box}#${pr.n} **${pr.title}** _(${pr.status})_\n${changes}\n  - why: ${pr.evidence || '(none)'}`;
        })
        .join('\n\n')
    : '_(nothing proposed yet)_';
  fs.writeFileSync(
    p('Proposals.md'),
    `# Proposals

Approve in Telegram with \`/approve N\`, or tick the box in [[Control]].
Risk limits, position size and the kill switch can never be proposed.

${body}
`,
  );
}
