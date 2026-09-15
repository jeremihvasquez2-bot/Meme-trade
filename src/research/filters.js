// Hard safety/liquidity filters. All must pass before a candidate is even scored.
// `features` is the hydrated candidate; `authorities` and `sellImpact` come from
// on-chain / Jupiter checks done by the caller (they're slow, so only run them
// after the cheap numeric filters already passed).
export function passesFilters(features, filters) {
  const reasons = [];

  if (features.liquidityUsd < filters.liquidityMinUsd || features.liquidityUsd > filters.liquidityMaxUsd) {
    reasons.push('liquidity out of range');
  }
  if (features.volume1hUsd < filters.volume1hMinUsd) {
    reasons.push('1h volume too low');
  }
  if (features.ageMs < filters.ageMinMs || features.ageMs > filters.ageMaxMs) {
    reasons.push('age out of range');
  }
  if (features.mcapUsd < filters.mcapMinUsd || features.mcapUsd > filters.mcapMaxUsd) {
    reasons.push('market cap out of range');
  }
  if ((features.buySellRatio5m ?? 0) < filters.buySellRatioMin) {
    reasons.push('buy/sell ratio too weak');
  }
  if (features.mintAuthorityRevoked === false || features.freezeAuthorityRevoked === false) {
    reasons.push('mint or freeze authority not revoked');
  }
  if ((features.rugcheckScore ?? Infinity) > filters.rugcheckScoreMax) {
    reasons.push('rugcheck score too high');
  }
  if (Array.isArray(features.rugcheckRisks) && features.rugcheckRisks.some((r) => r.level === 'danger')) {
    reasons.push('rugcheck danger risk');
  }
  if (features.sellPriceImpactPct !== undefined && features.sellPriceImpactPct > filters.sellPriceImpactMaxPct) {
    reasons.push('sell price impact too high (possible honeypot)');
  }
  if (features.sellPriceImpactPct === undefined) {
    reasons.push('no sell quote available');
  }

  return { passed: reasons.length === 0, reasons };
}
