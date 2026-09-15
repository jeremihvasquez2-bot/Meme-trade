#!/usr/bin/env node
// Start the bot when you log in. Windows: a shortcut in the Startup folder.
// macOS/Linux: a LaunchAgent / systemd user service. Undo with --remove.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const remove = process.argv.includes('--remove');

function windows() {
  const startup = path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
  const link = path.join(startup, 'memebot.cmd');
  if (remove) {
    fs.rmSync(link, { force: true });
    return `removed ${link}`;
  }
  fs.mkdirSync(startup, { recursive: true });
  fs.writeFileSync(link, `@echo off\r\nstart "" /min "${path.join(ROOT, 'run-memebot.cmd')}"\r\n`);
  return `installed ${link}`;
}

function macos() {
  const dir = path.join(os.homedir(), 'Library', 'LaunchAgents');
  const file = path.join(dir, 'com.memebot.plist');
  if (remove) {
    try {
      execFileSync('launchctl', ['unload', file]);
    } catch {
      /* not loaded */
    }
    fs.rmSync(file, { force: true });
    return `removed ${file}`;
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    file,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.memebot</string>
  <key>ProgramArguments</key><array><string>${process.execPath}</string><string>${path.join(ROOT, 'src', 'main.js')}</string></array>
  <key>WorkingDirectory</key><string>${ROOT}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardErrorPath</key><string>${path.join(ROOT, 'data', 'logs', 'autostart.log')}</string>
</dict></plist>
`,
  );
  execFileSync('launchctl', ['load', file]);
  return `installed ${file}`;
}

function linux() {
  const dir = path.join(os.homedir(), '.config', 'systemd', 'user');
  const file = path.join(dir, 'memebot.service');
  if (remove) {
    try {
      execFileSync('systemctl', ['--user', 'disable', '--now', 'memebot.service']);
    } catch {
      /* not enabled */
    }
    fs.rmSync(file, { force: true });
    return `removed ${file}`;
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    file,
    `[Unit]
Description=memebot
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${ROOT}
ExecStart=${process.execPath} ${path.join(ROOT, 'src', 'main.js')}
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`,
  );
  execFileSync('systemctl', ['--user', 'enable', '--now', 'memebot.service']);
  return `installed ${file}`;
}

try {
  const result = process.platform === 'win32' ? windows() : process.platform === 'darwin' ? macos() : linux();
  console.log(`✓ ${result}`);
  if (!remove) console.log('  It will start on its own next time you log in. Undo with: node scripts/install-autostart.js --remove');
} catch (err) {
  console.error(`✗ ${err.message}`);
  process.exit(1);
}
