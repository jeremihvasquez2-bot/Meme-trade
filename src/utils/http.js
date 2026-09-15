export async function fetchJson(url, { timeoutMs = 8000, retries = 2, headers = {}, ...opts } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...opts, headers, signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status} ${url}`);
        if (res.status >= 400 && res.status < 500 && res.status !== 429) throw lastErr;
      } else {
        return await res.json();
      }
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  throw lastErr;
}
