import test from 'node:test';
import assert from 'node:assert/strict';
import './helper.js';
import crypto from 'node:crypto';
import { cleanup } from './helper.js';
import { validate, mask, KEYS } from '../src/setkey.js';
import { encodeBase58 } from '../src/b58.js';

test.after(cleanup);

test('a BotFather token is recognised and a random string is not', () => {
  assert.equal(validate('TELEGRAM_BOT_TOKEN', '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw'), '');
  assert.match(validate('TELEGRAM_BOT_TOKEN', 'hello'), /BotFather/);
});

test('an Anthropic key must look like an Anthropic key', () => {
  assert.equal(validate('ANTHROPIC_API_KEY', 'sk-ant-api03-xxxx'), '');
  assert.match(validate('ANTHROPIC_API_KEY', 'abc123'), /sk-ant-/);
});

test('an RPC URL must be https', () => {
  assert.equal(validate('RPC_URL', 'https://mainnet.helius-rpc.com/?api-key=x'), '');
  assert.match(validate('RPC_URL', 'http://insecure'), /https/);
});

test('mode is paper or live and nothing else', () => {
  assert.equal(validate('MODE', 'live'), '');
  assert.match(validate('MODE', 'yolo'), /paper.*live/);
});

test('a real private key validates and a broken one does not', () => {
  const pair = crypto.generateKeyPairSync('ed25519');
  const seed = pair.privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32);
  const publicKey = pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  assert.equal(validate('WALLET_PRIVATE_KEY', encodeBase58(Buffer.concat([seed, publicKey]))), '');
  assert.match(validate('WALLET_PRIVATE_KEY', 'not-a-key'), /base58/);
});

test('an empty value is never saved', () => {
  assert.match(validate('TELEGRAM_BOT_TOKEN', ''), /cannot be empty/);
});

test('an unknown key is rejected with the list of real ones', () => {
  assert.match(validate('SOMETHING', 'x'), /unknown key/);
});

test('the wallet key can never be set from the phone page', () => {
  assert.equal(KEYS.WALLET_PRIVATE_KEY.phone, false);
  assert.equal(KEYS.TELEGRAM_BOT_TOKEN.phone, true);
});

test('masking never shows the middle of a secret', () => {
  assert.equal(mask(''), '(not set)');
  assert.equal(mask('12345678901234567890'), '1234…7890');
  assert.equal(mask('short'), '********');
});
