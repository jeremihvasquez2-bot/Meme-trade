import test from 'node:test';
import assert from 'node:assert/strict';
import './helper.js';
import fs from 'node:fs';
import { freshData, cleanup } from './helper.js';
import { acquireLock, releaseLock, lockFile, isRunning } from '../src/lock.js';

test.beforeEach(() => freshData());
test.after(cleanup);

test('the first instance takes the lock and writes its pid', () => {
  const result = acquireLock({ pid: 4242 });
  assert.equal(result.ok, true);
  assert.equal(JSON.parse(fs.readFileSync(lockFile(), 'utf8')).pid, 4242);
});

test('a second instance is refused while the first is alive', () => {
  acquireLock({ pid: process.pid });
  const second = acquireLock({ pid: process.pid + 1 });
  assert.equal(second.ok, false);
  assert.equal(second.holder.pid, process.pid);
});

test('a stale lock from a crashed run is taken over', () => {
  acquireLock({ pid: 999_999 });
  assert.equal(acquireLock({ pid: process.pid }).ok, true);
});

test('the same process re-acquiring its own lock is fine', () => {
  acquireLock({ pid: process.pid });
  assert.equal(acquireLock({ pid: process.pid }).ok, true);
});

test('releasing removes the lock file', () => {
  acquireLock({ pid: process.pid });
  releaseLock({ pid: process.pid });
  assert.equal(fs.existsSync(lockFile()), false);
});

test('another process cannot release our lock', () => {
  acquireLock({ pid: process.pid });
  releaseLock({ pid: process.pid + 1 });
  assert.equal(fs.existsSync(lockFile()), true);
});

test('isRunning tells a live pid from a dead one', () => {
  assert.equal(isRunning(process.pid), true);
  assert.equal(isRunning(999_999), false);
});
