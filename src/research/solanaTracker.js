import { fetchJson } from '../utils/http.js';

const BASE = 'https://data.solanatracker.io';

export async function getTopTraders(config, mint) {
  try {
    const data = await fetchJson(`${BASE}/top-traders/${mint}`, {
      headers: { 'x-api-key': config.solanaTrackerApiKey },
      retries: 1,
    });
    return data?.wallets ?? data?.traders ?? (Array.isArray(data) ? data : []);
  } catch {
    return [];
  }
}

export async function getWalletTrades(config, owner) {
  try {
    const data = await fetchJson(`${BASE}/wallet/${owner}/trades`, {
      headers: { 'x-api-key': config.solanaTrackerApiKey },
      retries: 1,
    });
    return data?.trades ?? (Array.isArray(data) ? data : []);
  } catch {
    return [];
  }
}
