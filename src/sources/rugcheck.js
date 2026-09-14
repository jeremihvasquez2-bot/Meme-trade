// RugCheck's summary endpoint. A score above the cap or any "danger" risk and
// the token never reaches scoring, however good the chart looks.
import { httpJson } from '../http.js';
import { num } from '../util.js';

const BASE = 'https://api.rugcheck.xyz/v1';

export function judge(summary, maxScore) {
  if (!summary) return { ok: false, score: null, dangers: [], reason: 'rugcheck unavailable' };
  const score = num(summary.score_normalised ?? summary.score, Number.POSITIVE_INFINITY);
  const risks = Array.isArray(summary.risks) ? summary.risks : [];
  const dangers = risks.filter((r) => String(r?.level).toLowerCase() === 'danger').map((r) => r.name);
  if (dangers.length) return { ok: false, score, dangers, reason: `rugcheck danger: ${dangers.join(', ')}` };
  if (!(score <= maxScore)) return { ok: false, score, dangers, reason: `rugcheck score ${score} > ${maxScore}` };
  return { ok: true, score, dangers, reason: '' };
}

export async function summary(mint) {
  try {
    return await httpJson(`${BASE}/tokens/${mint}/report/summary`, { tries: 2, timeoutMs: 10000 });
  } catch {
    return null;
  }
}
