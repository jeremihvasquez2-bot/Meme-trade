import { fmtUsd } from './format.js';

function includesAny(text, words) {
  return words.some((w) => text.includes(w));
}

// Free built-in keyword Q&A, used when no ANTHROPIC_API_KEY is configured (or
// as a fast path even when one is). Returns null if nothing matched, so the
// caller can fall back to the Claude-backed answerer.
export function matchKeywordAnswer(text, ctx) {
  const t = (text || '').toLowerCase();

  if (includesAny(t, ['how much made', 'how much profit', 'how much have you made'])) {
    return `Made ${fmtUsd(ctx.summary.made)} across ${ctx.summary.wins} wins.`;
  }
  if (includesAny(t, ['how much lost', 'how much have you lost'])) {
    return `Lost ${fmtUsd(ctx.summary.lost)} across ${ctx.summary.losses} losses.`;
  }
  if (includesAny(t, ['round', 'rounds'])) {
    return ctx.state.mode === 'paper'
      ? `Round ${ctx.state.round.number}, target ${fmtUsd(ctx.state.round.targetUsd)}. Rounds won ${ctx.state.rounds.won}, lost ${ctx.state.rounds.lost}.`
      : 'Live mode has no rounds — one ongoing bankroll.';
  }
  if (includesAny(t, ['sim', 'simulate', 'monte carlo'])) {
    return ctx.simSummary
      ? `Last simulation: round win rate ${(ctx.simSummary.roundWinRate * 100).toFixed(0)}%, ${(ctx.simSummary.pctTrialsNetPositive * 100).toFixed(0)}% of trials ended net positive.`
      : 'No simulation has been run yet. Try `npm run simulate`.';
  }
  if (includesAny(t, ['holding', 'holdings', 'open position'])) {
    return ctx.positions.length
      ? ctx.positions.map((p) => `${p.symbol} — ${fmtUsd(p.sizeUsd)} in`).join('\n')
      : 'No open positions right now.';
  }
  if (includesAny(t, ['ready', 'readiness', 'go live'])) {
    return ctx.readiness
      ? `${ctx.readiness.go ? 'GO' : 'NOT YET'} — ${ctx.readiness.unmet.length ? `still needs: ${ctx.readiness.unmet.join(', ')}` : 'all gates cleared'}`
      : 'Readiness has not been checked yet. Run `npm run status`.';
  }
  const soldMatch = t.match(/why did you sell (\w+)/);
  if (soldMatch) {
    const symbol = soldMatch[1].toUpperCase();
    const trade = [...ctx.trades].reverse().find((tr) => (tr.symbol || '').toUpperCase() === symbol);
    return trade
      ? `Sold ${trade.symbol} because of ${trade.exitReason}. Whole trade P&L: ${fmtUsd(trade.pnlUsd)}.`
      : `No closed trade found for ${symbol}.`;
  }
  if (includesAny(t, ['lesson', 'lessons', 'learned'])) {
    return ctx.lessonsText || 'No lessons recorded yet.';
  }
  return null;
}
