export const READINESS_REQUIREMENTS = {
  minClosedTrades: 30,
  minDays: 14,
  minNetUsd: 10,
  minReplayPaths: 40,
  minReplayAvgReturnPct: 8,
  minRoundsWon: 3,
};

export function checkReadiness({ summary, state, replaySummary }) {
  const unmet = [];

  if (summary.closedCount < READINESS_REQUIREMENTS.minClosedTrades) {
    unmet.push(`${summary.closedCount}/${READINESS_REQUIREMENTS.minClosedTrades} closed trades`);
  }
  if (summary.spanDays < READINESS_REQUIREMENTS.minDays) {
    unmet.push(`${summary.spanDays.toFixed(1)}/${READINESS_REQUIREMENTS.minDays} days`);
  }
  if (summary.net < READINESS_REQUIREMENTS.minNetUsd) {
    unmet.push(`net P&L $${summary.net.toFixed(2)} < $${READINESS_REQUIREMENTS.minNetUsd}`);
  }
  if (!replaySummary || replaySummary.count < READINESS_REQUIREMENTS.minReplayPaths) {
    unmet.push(`${replaySummary?.count ?? 0}/${READINESS_REQUIREMENTS.minReplayPaths} replayed paths`);
  } else if (replaySummary.avgReturnPct < READINESS_REQUIREMENTS.minReplayAvgReturnPct) {
    unmet.push(`replay avg return ${replaySummary.avgReturnPct.toFixed(1)}% < ${READINESS_REQUIREMENTS.minReplayAvgReturnPct}%`);
  }
  if (state.rounds.won < READINESS_REQUIREMENTS.minRoundsWon || state.rounds.won <= state.rounds.lost) {
    unmet.push(`rounds won ${state.rounds.won} vs lost ${state.rounds.lost} (need >= ${READINESS_REQUIREMENTS.minRoundsWon} and more won than lost)`);
  }
  if (summary.profitableWeeks < 2) {
    unmet.push(`profitable in ${summary.profitableWeeks}/2 separate weeks`);
  }
  if (state.halted) {
    unmet.push('bot is halted');
  }

  return { go: unmet.length === 0, unmet };
}
