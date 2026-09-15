import fs from 'node:fs';
import path from 'node:path';
import { ensureDir } from '../utils/store.js';
import { defaultControlNote } from './control.js';
import { fmtUsd } from '../telegram/format.js';

function paths(config) {
  const root = config.brainDir;
  return {
    root,
    home: path.join(root, 'Home.md'),
    control: path.join(root, 'Control.md'),
    lessons: path.join(root, 'Lessons.md'),
    rules: path.join(root, 'Rules.md'),
    proposals: path.join(root, 'Proposals.md'),
    journalDir: path.join(root, 'Journal'),
    tokensDir: path.join(root, 'Tokens'),
    walletsDir: path.join(root, 'Wallets'),
  };
}

export function ensureBrain(config) {
  const p = paths(config);
  for (const dir of [p.root, p.journalDir, p.tokensDir, p.walletsDir]) ensureDir(dir);
  if (!fs.existsSync(p.control)) fs.writeFileSync(p.control, defaultControlNote());
  if (!fs.existsSync(p.lessons)) fs.writeFileSync(p.lessons, '# Lessons\n');
  if (!fs.existsSync(p.proposals)) fs.writeFileSync(p.proposals, '# Proposals\n');
  return p;
}

export function readControlNote(config) {
  const p = ensureBrain(config);
  return fs.readFileSync(p.control, 'utf8');
}

export function writeHomeNote(config, { state, summary, positions, readiness }) {
  const p = ensureBrain(config);
  const lines = [
    '# MEMEBOT',
    '',
    `_Last updated: ${new Date().toISOString()}_`,
    '',
    `**Mode:** ${state.mode}`,
    state.mode === 'paper'
      ? `**Bankroll:** ${fmtUsd(state.bankrollUsd)} of ${fmtUsd(state.round.targetUsd)} target · Round ${state.round.number} · Rounds won ${state.rounds.won} – lost ${state.rounds.lost}`
      : `**Bankroll:** ${fmtUsd(state.bankrollUsd)} · Realized P&L ${fmtUsd(state.realizedPnlUsd)}`,
    `**Made / Lost / Net:** ${fmtUsd(summary.made)} / ${fmtUsd(summary.lost)} / ${fmtUsd(summary.net)}`,
    `**Record:** ${summary.wins} WIN – ${summary.losses} LOSE`,
    `**Halted:** ${state.halted ? `yes — ${state.haltedReason}` : 'no'} · **Paused:** ${state.paused ? 'yes' : 'no'}`,
    '',
    '## Readiness',
    readiness
      ? `${readiness.go ? '✅ GO' : '⏳ NOT YET'}${readiness.unmet.length ? `\n- Still needed: ${readiness.unmet.join(', ')}` : ''}`
      : 'Not checked yet — run `npm run status`.',
    '',
    '## Open positions',
    positions.length ? positions.map((pos) => `- ${pos.symbol} — ${fmtUsd(pos.sizeUsd)} in, entry ${pos.entryPriceUsd}`).join('\n') : '_none_',
    '',
    '## See also',
    '- [[Control]] — pause the bot, block tokens, follow wallets, approve proposals',
    '- [[Rules]] — current tunable rules and tune history',
    '- [[Proposals]] — pending and past config change proposals',
    '- [[Lessons]] — rule-drawn lessons from closed trades',
  ];
  fs.writeFileSync(p.home, lines.join('\n'));
}

export function appendJournal(config, text) {
  const p = ensureBrain(config);
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(p.journalDir, `${day}.md`);
  const line = `- ${new Date().toISOString().slice(11, 19)} — ${text}\n`;
  if (!fs.existsSync(file)) fs.writeFileSync(file, `# ${day}\n\n`);
  fs.appendFileSync(file, line);
}

export function writeTokenNote(config, trade, { whyBought = '', safetyAtEntry = '', timeline = [], lesson = '' } = {}) {
  const p = ensureBrain(config);
  const file = path.join(p.tokensDir, `${trade.symbol || trade.mint}.md`);
  const lines = [
    '---',
    `pnl: ${trade.pnlUsd.toFixed(2)}`,
    `peak_multiple: ${(trade.fills?.reduce((m, f) => Math.max(m, f.priceUsd || 0), 0) / (trade.fills?.[0]?.priceUsd || 1)).toFixed(2)}`,
    `hold_time_min: ${((trade.closedAt - trade.openedAt) / 60000).toFixed(1)}`,
    `outcome: ${trade.outcome}`,
    '---',
    '',
    `# ${trade.symbol || trade.mint}`,
    '',
    `**Why bought:** ${whyBought || '_not recorded_'}`,
    `**Safety at entry:** ${safetyAtEntry || '_not recorded_'}`,
    '',
    '## Timeline',
    timeline.length ? timeline.map((t) => `- ${t}`).join('\n') : '_none recorded_',
    '',
    `## Lesson`,
    lesson || '_none drawn_',
  ];
  fs.writeFileSync(file, lines.join('\n'));
}

export function writeWalletNote(config, address, stats) {
  const p = ensureBrain(config);
  const file = path.join(p.walletsDir, `${address.slice(0, 8)}.md`);
  const lines = [
    `# ${address}`,
    '',
    `Round trips: ${stats.roundTrips}`,
    `Median hold: ${stats.medianHoldMin?.toFixed(1)} min`,
    `Win rate: ${(stats.winRate * 100).toFixed(0)}%`,
    `Followed since: ${stats.followedSince || new Date().toISOString()}`,
  ];
  fs.writeFileSync(file, lines.join('\n'));
}

export function appendLesson(config, lesson) {
  const p = ensureBrain(config);
  fs.appendFileSync(p.lessons, `\n- ${new Date().toISOString().slice(0, 10)}: ${lesson}`);
}

export function writeRulesNote(config, rules, tuneHistory = []) {
  const p = ensureBrain(config);
  const lines = [
    '# Rules',
    '',
    '```json',
    JSON.stringify(rules, null, 2),
    '```',
    '',
    '## Tune history',
    tuneHistory.length ? tuneHistory.map((h) => `- ${h}`).join('\n') : '_none yet_',
  ];
  fs.writeFileSync(p.rules, lines.join('\n'));
}

export function writeProposalsNote(config, proposals) {
  const p = ensureBrain(config);
  const lines = ['# Proposals', ''];
  for (const prop of [...proposals].reverse()) {
    lines.push(`## #${prop.id} ${prop.title} — ${prop.status}`);
    lines.push(`Evidence: ${prop.evidence}`);
    lines.push(`Changes: ${Object.entries(prop.changes).map(([k, v]) => `${k}: ${v.old} → ${v.new}`).join(', ')}`);
    lines.push('');
  }
  fs.writeFileSync(p.proposals, lines.join('\n'));
}
