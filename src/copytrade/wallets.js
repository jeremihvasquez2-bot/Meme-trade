const CASH_MINTS = new Set([
  'So11111111111111111111111111111111111111112', // SOL
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
]);

// Solana Tracker's wallet trades payload isn't fully documented publicly, so
// this accepts either shape it's known to return and normalizes to a common
// {ts, mint, side, usdValue} record. A trade is a "buy" of `mint` when cash
// flows out and a non-cash token flows in, and vice versa for "sell".
export function normalizeTrades(raw) {
  return raw
    .map((t) => {
      const ts = t.time ?? t.timestamp ?? t.blockTime ?? 0;
      const fromMint = t.from?.address ?? t.fromMint ?? t.tokenIn;
      const toMint = t.to?.address ?? t.toMint ?? t.tokenOut;
      const usdValue = Number(t.volume?.usd ?? t.usdValue ?? t.amountUsd ?? 0);
      if (!fromMint || !toMint) return null;
      if (CASH_MINTS.has(fromMint) && !CASH_MINTS.has(toMint)) {
        return { ts: Number(ts) * (ts < 2e10 ? 1000 : 1), mint: toMint, side: 'buy', usdValue };
      }
      if (!CASH_MINTS.has(fromMint) && CASH_MINTS.has(toMint)) {
        return { ts: Number(ts) * (ts < 2e10 ? 1000 : 1), mint: fromMint, side: 'sell', usdValue };
      }
      return null;
    })
    .filter(Boolean)
    .sort((a, b) => a.ts - b.ts);
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// FIFO-matches buys to sells per mint to reconstruct round trips.
export function reconstructRoundTrips(trades) {
  const byMint = new Map();
  for (const t of trades) {
    if (!byMint.has(t.mint)) byMint.set(t.mint, []);
    byMint.get(t.mint).push(t);
  }

  const roundTrips = [];
  for (const [mint, mintTrades] of byMint) {
    const buys = mintTrades.filter((t) => t.side === 'buy').slice();
    const sells = mintTrades.filter((t) => t.side === 'sell').slice();
    let bi = 0;
    for (const sell of sells) {
      if (bi >= buys.length) break;
      const buy = buys[bi++];
      roundTrips.push({
        mint,
        entryTs: buy.ts,
        exitTs: sell.ts,
        holdMin: (sell.ts - buy.ts) / 60000,
        pnlUsd: sell.usdValue - buy.usdValue,
      });
    }
  }
  return roundTrips;
}

// Returns null if the wallet doesn't qualify.
export function qualifyWallet(rawTrades, rules) {
  const trades = normalizeTrades(rawTrades);
  const roundTrips = reconstructRoundTrips(trades);
  if (roundTrips.length < rules.minRoundTrips) return null;

  const medianHoldMin = median(roundTrips.map((r) => r.holdMin));
  if (medianHoldMin < rules.minMedianHoldMin) return null;

  const wins = roundTrips.filter((r) => r.pnlUsd > 0).length;
  const winRate = wins / roundTrips.length;
  if (winRate < rules.minWinRate) return null;

  return { roundTrips: roundTrips.length, medianHoldMin, winRate };
}
