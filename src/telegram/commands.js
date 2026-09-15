import { headerBlock, footerBlock, fmtUsd } from './format.js';

export function parseCommand(text) {
  const trimmed = (text || '').trim();
  if (!trimmed.startsWith('/')) return null;
  const [cmd, ...args] = trimmed.slice(1).split(/\s+/);
  return { command: cmd.toLowerCase(), args };
}

// Pure: given a snapshot of bot state, returns { reply, action }. `action`
// (if any) tells the caller what side effect to actually perform and persist
// — commands.js itself never mutates or touches disk, so it's trivially testable.
export function buildReply(command, args, ctx) {
  switch (command) {
    case 'status': {
      const lines = [headerBlock(ctx), '', ...ctx.positions.map((p) => `• ${p.symbol} ${fmtUsd(p.sizeUsd)} @ ${p.entryPriceUsd}`), '', footerBlock(ctx.summary)];
      return { reply: lines.join('\n'), action: null };
    }
    case 'positions': {
      if (!ctx.positions.length) return { reply: 'No open positions.', action: null };
      const lines = ctx.positions.map((p) => `• ${p.symbol} (${p.mint.slice(0, 6)}…) size ${fmtUsd(p.sizeUsd)} entry ${p.entryPriceUsd}`);
      return { reply: lines.join('\n'), action: null };
    }
    case 'money': {
      return { reply: [headerBlock(ctx), footerBlock(ctx.summary)].join('\n\n'), action: null };
    }
    case 'pause':
      return { reply: 'Paused. No new positions will be opened until /resume.', action: { type: 'pause' } };
    case 'resume':
      return { reply: 'Resumed.', action: { type: 'resume' } };
    case 'stop':
      if (args[0] === 'confirm') return { reply: 'Stopping. All monitoring halted.', action: { type: 'stop' } };
      return { reply: 'This halts the bot entirely. Send "/stop confirm" to proceed.', action: null };
    case 'proposals': {
      const pending = ctx.proposals.filter((p) => p.status === 'pending');
      if (!pending.length) return { reply: 'No pending proposals.', action: null };
      const lines = pending.map((p) => `#${p.id} ${p.title} — ${Object.keys(p.changes).join(', ')}`);
      return { reply: lines.join('\n'), action: null };
    }
    case 'approve': {
      const id = Number(args[0]);
      if (!id) return { reply: 'Usage: /approve N', action: null };
      return { reply: `Approving proposal #${id}…`, action: { type: 'approve', id } };
    }
    case 'reject': {
      const id = Number(args[0]);
      if (!id) return { reply: 'Usage: /reject N', action: null };
      return { reply: `Rejected proposal #${id}.`, action: { type: 'reject', id } };
    }
    default:
      return { reply: `Unknown command: /${command}`, action: null };
  }
}
