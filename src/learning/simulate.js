function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Monte Carlo bankroll simulation. `returnMultiples` is a pool of real
// trade-level return multiples (from replay or closed trades) sampled with
// replacement to stand in for "the next N trades." Runs the actual position
// sizing / round rules so results reflect compounding and round resets.
export function simulateOneTrial({ returnMultiples, tradesPerTrial, startingBankrollUsd, rules }) {
  let bankroll = startingBankrollUsd;
  let round = { number: 1, targetUsd: rules.roundStartTargetUsd };
  let roundsWon = 0;
  let roundsLost = 0;

  for (let i = 0; i < tradesPerTrial; i++) {
    const sizeUsd = Math.min(Math.max(bankroll * rules.positionSizePct, rules.positionMinUsd), rules.positionMaxUsd, bankroll);
    if (sizeUsd < rules.positionMinUsd) break;

    const multiple = pick(returnMultiples);
    const pnlUsd = sizeUsd * (multiple - 1);
    bankroll += pnlUsd;

    if (bankroll <= 0) {
      roundsLost += 1;
      bankroll = startingBankrollUsd;
      round = { number: round.number + 1, targetUsd: round.targetUsd };
    } else if (bankroll >= round.targetUsd) {
      roundsWon += 1;
      bankroll = startingBankrollUsd;
      round = { number: round.number + 1, targetUsd: round.targetUsd + rules.roundTargetStepUsd };
    }
  }

  return { endingBankrollUsd: bankroll, roundsWon, roundsLost, finalRound: round.number };
}

export function monteCarlo({ returnMultiples, trials = 1000, tradesPerTrial = 50, startingBankrollUsd, rules }) {
  if (!returnMultiples.length) throw new Error('need at least one historical return multiple to simulate from');
  const results = [];
  for (let i = 0; i < trials; i++) {
    results.push(simulateOneTrial({ returnMultiples, tradesPerTrial, startingBankrollUsd, rules }));
  }
  const roundsWonTotal = results.reduce((s, r) => s + r.roundsWon, 0);
  const roundsLostTotal = results.reduce((s, r) => s + r.roundsLost, 0);
  return {
    trials,
    tradesPerTrial,
    avgRoundsWon: roundsWonTotal / trials,
    avgRoundsLost: roundsLostTotal / trials,
    roundWinRate: roundsWonTotal + roundsLostTotal ? roundsWonTotal / (roundsWonTotal + roundsLostTotal) : 0,
    pctTrialsNetPositive: results.filter((r) => r.roundsWon > r.roundsLost).length / trials,
  };
}
