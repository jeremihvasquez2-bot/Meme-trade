export function fmtUsd(n) {
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

export function headerBlock({ state, openPositionsValueUsd = 0 }) {
  const total = state.bankrollUsd + openPositionsValueUsd;
  const target = state.mode === 'paper' ? state.round.targetUsd : state.originalBankrollUsd;
  const lines = [
    `💰 WALLET ${fmtUsd(state.bankrollUsd)} of ${fmtUsd(target)} (${fmtUsd(openPositionsValueUsd)} in open trades)`,
  ];
  if (state.mode === 'paper') {
    lines.push(`ROUND ${state.round.number} → target ${fmtUsd(state.round.targetUsd)} · ROUNDS WON ${state.rounds.won} – LOST ${state.rounds.lost}`);
  }
  void total;
  return lines.join('\n');
}

export function footerBlock(summary) {
  return [
    `MADE ${fmtUsd(summary.made)} · LOST ${fmtUsd(summary.lost)} · NET ${summary.net >= 0 ? '+' : ''}${fmtUsd(summary.net)}`,
    `RECORD: ${summary.wins} WIN – ${summary.losses} LOSE`,
  ].join('\n');
}

export function sellAlert({ trade, positionPeakMultiple }) {
  const emoji = trade.outcome === 'WIN' ? '🟢 WIN' : '🔴 LOSE';
  return [
    `${emoji} ${trade.symbol || trade.mint}`,
    `this sale: ${fmtUsd(trade.fills.at(-1)?.amountUsd ?? 0)} (${trade.exitReason})`,
    `whole trade: ${fmtUsd(trade.pnlUsd)} (${(trade.pnlPct * 100).toFixed(1)}%)${positionPeakMultiple ? ` · peak ${positionPeakMultiple.toFixed(2)}x` : ''}`,
  ].join('\n');
}
