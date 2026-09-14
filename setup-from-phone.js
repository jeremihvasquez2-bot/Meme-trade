#!/usr/bin/env node
// A one-time setup page on your own Wi-Fi, so you can paste tokens from the
// phone that has them instead of retyping them at the PC.
//
// - it is only up while this command runs
// - it needs the code printed in this terminal
// - it will not accept the wallet private key, ever
import http from 'node:http';
import os from 'node:os';
import { KEYS, setKey, validate, mask } from './src/setkey.js';
import { cfg } from './src/config.js';

const CODE = String(Math.floor(100000 + Math.random() * 900000));
const PORT = Number(process.env.SETUP_PORT || 8899);
const PHONE_KEYS = Object.entries(KEYS).filter(([, spec]) => spec.phone);
const DEADLINE = Date.now() + 15 * 60 * 1000;

function lanAddress() {
  for (const rows of Object.values(os.networkInterfaces())) {
    for (const row of rows || []) {
      if (row.family === 'IPv4' && !row.internal) return row.address;
    }
  }
  return '127.0.0.1';
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function page({ message = '', ok = false } = {}) {
  const fields = PHONE_KEYS.map(
    ([key, spec]) => `
    <label>${esc(spec.label)}
      <small>${esc(spec.hint)} — currently ${esc(mask(cfg[key]))}</small>
      <input name="${key}" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="leave blank to keep">
    </label>`,
  ).join('');
  return `<!doctype html><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>memebot setup</title>
<style>
  body{font:16px/1.5 system-ui,sans-serif;margin:0;padding:24px;background:#12121a;color:#eee;max-width:34rem}
  h1{font-size:1.3rem} label{display:block;margin:1.2rem 0}
  small{display:block;color:#9aa;font-size:.8rem;margin:.2rem 0}
  input{width:100%;box-sizing:border-box;padding:.7rem;border-radius:.5rem;border:1px solid #445;background:#1c1c28;color:#eee;font-size:1rem}
  button{margin-top:1rem;width:100%;padding:.9rem;border:0;border-radius:.5rem;background:#5b7cfa;color:#fff;font-size:1rem;font-weight:600}
  .msg{padding:.8rem;border-radius:.5rem;background:${ok ? '#14432a' : '#4a1d1d'};margin-bottom:1rem}
  .note{color:#9aa;font-size:.85rem;margin-top:2rem}
</style>
<h1>memebot setup</h1>
${message ? `<div class=msg>${esc(message)}</div>` : ''}
<form method=post>
  <label>Code from the terminal
    <small>six digits, printed where you started this</small>
    <input name=code inputmode=numeric autocomplete=off required>
  </label>
  ${fields}
  <button>Save to .env</button>
</form>
<p class=note>This page is only up while the setup command is running, and only on your own network.
The wallet private key can never be set here — do that at the PC with <code>node set-key.js</code>.</p>`;
}

const server = http.createServer((req, res) => {
  if (Date.now() > DEADLINE) {
    res.writeHead(410, { 'content-type': 'text/plain' }).end('Setup window closed. Run the command again.');
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page());
    return;
  }
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 20000) req.destroy();
  });
  req.on('end', () => {
    const form = new URLSearchParams(body);
    if (form.get('code') !== CODE) {
      res.writeHead(403, { 'content-type': 'text/html; charset=utf-8' }).end(page({ message: 'Wrong code.' }));
      return;
    }
    const saved = [];
    const errors = [];
    for (const [key] of PHONE_KEYS) {
      const value = (form.get(key) || '').trim();
      if (!value) continue;
      const error = validate(key, value);
      if (error) {
        errors.push(`${key}: ${error}`);
        continue;
      }
      setKey(key, value);
      saved.push(key);
    }
    const message = errors.length
      ? `Saved ${saved.length}. Problems: ${errors.join(' · ')}`
      : saved.length
        ? `Saved: ${saved.join(', ')}. You can close this page and start the bot.`
        : 'Nothing to save.';
    console.log(`  ${errors.length ? '✗' : '✓'} ${message}`);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page({ message, ok: !errors.length }));
    if (saved.length && !errors.length) setTimeout(() => process.exit(0), 1500);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  memebot setup — open this on your phone (same Wi-Fi):\n');
  console.log(`      http://${lanAddress()}:${PORT}\n`);
  console.log(`  Code: ${CODE}`);
  console.log('  The page closes in 15 minutes, or when you save.\n');
});
setTimeout(() => {
  console.log('  Setup window closed.');
  process.exit(0);
}, 15 * 60 * 1000).unref?.();
