import http from 'node:http';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

const PORT = 8787;
const CODE = crypto.randomInt(100000, 999999).toString();

function localIp() {
  const nets = os.networkInterfaces();
  for (const ifaceList of Object.values(nets)) {
    for (const iface of ifaceList || []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

const FIELDS = [
  { name: 'TELEGRAM_BOT_TOKEN', label: 'Telegram bot token (from @BotFather)' },
  { name: 'SOLANA_TRACKER_API_KEY', label: 'Solana Tracker Data API key' },
  { name: 'HELIUS_API_KEY', label: 'Helius RPC key (optional)' },
  { name: 'ANTHROPIC_API_KEY', label: 'Anthropic API key (optional)' },
];

function page(message = '') {
  const fields = FIELDS.map(
    (f) => `<label>${f.label}<br><input name="${f.name}" style="width:100%;padding:8px;margin:4px 0 12px"></label>`,
  ).join('\n');
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>memebot setup</title></head>
  <body style="font-family:sans-serif;max-width:480px;margin:24px auto;padding:0 16px">
  <h2>memebot setup</h2>
  ${message ? `<p style="color:green">${message}</p>` : ''}
  <form method="POST">
    <label>Access code (shown in your terminal)<br><input name="code" style="width:100%;padding:8px;margin:4px 0 12px"></label>
    ${fields}
    <button type="submit" style="padding:10px 20px">Save</button>
  </form>
  <p style="color:#888;font-size:13px">Leave a field blank to skip it. Nothing here is sent anywhere except this bot's own .env file on your computer.</p>
  </body></html>`;
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => resolve(new URLSearchParams(body)));
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(page());
    return;
  }

  if (req.method === 'POST') {
    const params = await parseBody(req);
    if (params.get('code') !== CODE) {
      res.writeHead(403, { 'Content-Type': 'text/html' });
      res.end(page('Wrong code.'));
      return;
    }
    const set = [];
    for (const f of FIELDS) {
      const value = params.get(f.name);
      if (value) {
        const result = spawnSync('node', ['set-key.js', f.name, value], { encoding: 'utf8' });
        set.push(result.status === 0 ? `${f.name}: saved` : `${f.name}: ${result.stderr.trim() || result.stdout.trim()}`);
      }
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(page(set.length ? set.join('<br>') : 'Nothing to save.'));
    return;
  }

  res.writeHead(405);
  res.end();
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\nOpen this on your phone (same Wi-Fi as this computer):\n`);
  console.log(`  http://${localIp()}:${PORT}\n`);
  console.log(`Access code: ${CODE}\n`);
  console.log('Press Ctrl+C when done.');
});
