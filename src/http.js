// One place for outbound HTTP so tests can swap in a fake and so every call
// gets a timeout — a hung fetch must never stall the trade loop.
import { retry } from './util.js';

let impl = globalThis.fetch;

export function setFetch(fn) {
  impl = fn;
}
export function resetFetch() {
  impl = globalThis.fetch;
}

export class HttpError extends Error {
  constructor(status, url, body) {
    super(`HTTP ${status} ${url}`);
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

export async function httpJson(url, { timeoutMs = 12000, headers = {}, method = 'GET', body, tries = 2 } = {}) {
  return retry(
    async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await impl(url, {
          method,
          headers: body ? { 'content-type': 'application/json', ...headers } : headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: ctrl.signal,
        });
        const text = await res.text();
        if (!res.ok) throw new HttpError(res.status, url, text.slice(0, 300));
        return text ? JSON.parse(text) : null;
      } finally {
        clearTimeout(timer);
      }
    },
    { tries, baseMs: 400 },
  );
}

/** Same, but a failure returns `fallback` instead of throwing. */
export async function httpJsonSoft(url, opts = {}, fallback = null) {
  try {
    return await httpJson(url, opts);
  } catch {
    return fallback;
  }
}
