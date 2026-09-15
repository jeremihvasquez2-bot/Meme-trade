import test from 'node:test';
import assert from 'node:assert/strict';
import './helper.js';
import crypto from 'node:crypto';
import { cleanup } from './helper.js';
import { encodeBase58, decodeBase58, isBase58 } from '../src/b58.js';
import { keypairFromSecret, signSerializedTransaction, readCompactU16 } from '../src/wallet.js';

test.after(cleanup);

function generate() {
  const pair = crypto.generateKeyPairSync('ed25519');
  const seed = pair.privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32);
  const publicKey = pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  return { pair, secret: encodeBase58(Buffer.concat([seed, publicKey])), publicKey };
}

test('base58 round-trips, leading zeros included', () => {
  for (const hex of ['00', '0000ff', 'deadbeef', '01020304050607']) {
    const bytes = Buffer.from(hex, 'hex');
    assert.deepEqual(Buffer.from(decodeBase58(encodeBase58(bytes))), bytes);
  }
});

test('base58 rejects characters that are not in the alphabet', () => {
  assert.throws(() => decodeBase58('0OIl'), /invalid base58/);
  assert.equal(isBase58('notvalid0'), false);
});

test('a Phantom-style 64-byte key loads and yields its public key', () => {
  const { secret, publicKey } = generate();
  const keypair = keypairFromSecret(secret);
  assert.equal(keypair.publicKey, encodeBase58(publicKey));
  assert.equal(isBase58(secret, [64]), true);
});

test('a key whose public half does not match the seed is refused', () => {
  const { secret } = generate();
  const bytes = decodeBase58(secret);
  bytes[40] ^= 0xff;
  assert.throws(() => keypairFromSecret(encodeBase58(bytes)), /malformed/);
});

test('a key of the wrong length is refused', () => {
  assert.throws(() => keypairFromSecret(encodeBase58(Buffer.alloc(16))), /32 or 64 bytes/);
});

test('compact-u16 decodes single and multi byte lengths', () => {
  assert.deepEqual(readCompactU16(Uint8Array.from([1]), 0), { value: 1, size: 1 });
  assert.deepEqual(readCompactU16(Uint8Array.from([0x80, 0x01]), 0), { value: 128, size: 2 });
});

test('signing a transaction produces a signature the chain would accept', () => {
  const { pair, secret } = generate();
  const keypair = keypairFromSecret(secret);
  const message = Buffer.from('a serialised solana message');
  const unsigned = Buffer.concat([Buffer.from([1]), Buffer.alloc(64), message]);
  const signed = signSerializedTransaction(unsigned.toString('base64'), keypair);
  const bytes = Buffer.from(signed.base64, 'base64');
  assert.equal(crypto.verify(null, bytes.subarray(65), pair.publicKey, bytes.subarray(1, 65)), true);
  assert.equal(decodeBase58(signed.signature).length, 64);
});

test('a transaction with no signature slot is refused', () => {
  const { secret } = generate();
  const keypair = keypairFromSecret(secret);
  const unsigned = Buffer.concat([Buffer.from([0]), Buffer.from('msg')]);
  assert.throws(() => signSerializedTransaction(unsigned.toString('base64'), keypair), /no signature slots/);
});
