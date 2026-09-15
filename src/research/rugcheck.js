import { fetchJson } from '../utils/http.js';

// Returns null if the report can't be fetched (caller should treat that as
// "not safe to buy" rather than assuming a clean score).
export async function getRugcheckSummary(mint) {
  try {
    const data = await fetchJson(`https://api.rugcheck.xyz/v1/tokens/${mint}/report/summary`, { retries: 1, timeoutMs: 6000 });
    return {
      score: data?.score ?? data?.score_normalised ?? 2000,
      risks: (data?.risks ?? []).map((r) => ({ name: r.name, level: r.level })),
    };
  } catch {
    return null;
  }
}
