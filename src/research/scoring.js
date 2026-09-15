function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

// 0-100 score across five weighted components. Only called on candidates that
// already passed the hard safety filters, so this is about ranking, not safety.
export function scoreCandidate(features) {
  const momentum = clamp(((features.m5Pct ?? 0) * 2 + (features.h1Pct ?? 0)) / 2, -100, 100);
  const momentumScore = clamp((momentum / 40) * 25, 0, 25);

  const buyPressureScore = clamp(((features.buySellRatio5m ?? 1) - 1) / 2, 0, 1) * 25;

  const turnover = features.mcapUsd > 0 ? features.volume1hUsd / features.mcapUsd : 0;
  const turnoverScore = clamp(turnover / 0.5, 0, 1) * 20;

  const rugcheckScore = features.rugcheckScore ?? 2000;
  const safetyScore = clamp(1 - rugcheckScore / 2000, 0, 1) * 20;

  const ageHrs = (features.ageMs ?? 0) / 3_600_000;
  const ageScore = clamp(1 - Math.abs(ageHrs - 3) / 20, 0, 1) * 10;

  const total = momentumScore + buyPressureScore + turnoverScore + safetyScore + ageScore;

  return {
    score: Math.round(clamp(total, 0, 100)),
    breakdown: {
      momentumScore: Math.round(momentumScore),
      buyPressureScore: Math.round(buyPressureScore),
      turnoverScore: Math.round(turnoverScore),
      safetyScore: Math.round(safetyScore),
      ageScore: Math.round(ageScore),
    },
  };
}
