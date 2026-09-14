// Local signing. The private key is read from .env, never leaves this process,
// and is never logged. Signing a Jupiter transaction only needs ed25519 and a
// little byte surgery, so there is no wallet dependency to trust.
import crypto from 'node:crypto';
import { decodeBase58, encodeBase58 } from './b58.js';
import { cfg } from './config.js';

const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

export function keypairFromSecret(secret) {
  const bytes = decodeBase58(secret);
  if (bytes.length !== 64 && bytes.length !== 32) {
    throw new Error('private key must decode to 32 or 64 bytes (Phantom exports 64)');
  }
  const seed = bytes.slice(0, 32);
  const privateKey = crypto.createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(seed)]),
    format: 'der',
    type: 'pkcs8',
  });
  const publicKey = crypto.createPublicKey(privateKey);
  const rawPublic = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  if (bytes.length === 64 && !Buffer.from(bytes.slice(32)).equals(rawPublic)) {
    throw new Error('private key is malformed: public half does not match the seed');
  }
  return { privateKey, publicKey: encodeBase58(rawPublic), rawPublic };
}

export function loadKeypair() {
  if (!cfg.WALLET_PRIVATE_KEY) throw new Error('WALLET_PRIVATE_KEY is not set — run: node set-key.js WALLET_PRIVATE_KEY <key>');
  return keypairFromSecret(cfg.WALLET_PRIVATE_KEY);
}

/** compact-u16, the length prefix Solana uses for its vectors. */
export function readCompactU16(bytes, offset) {
  let value = 0;
  let size = 0;
  for (;;) {
    const byte = bytes[offset + size];
    value |= (byte & 0x7f) << (size * 7);
    size += 1;
    if ((byte & 0x80) === 0) break;
    if (size > 3) throw new Error('bad compact-u16');
  }
  return { value, size };
}

/**
 * Jupiter hands back a serialised transaction with empty signature slots.
 * Fill slot 0 with our signature over the message and hand it back.
 */
export function signSerializedTransaction(base64Tx, keypair) {
  const bytes = Buffer.from(base64Tx, 'base64');
  const { value: sigCount, size: prefixSize } = readCompactU16(bytes, 0);
  if (sigCount < 1) throw new Error('transaction has no signature slots');
  const messageOffset = prefixSize + sigCount * 64;
  const message = bytes.subarray(messageOffset);
  const signature = crypto.sign(null, message, keypair.privateKey);
  if (signature.length !== 64) throw new Error('unexpected signature length');
  signature.copy(bytes, prefixSize);
  return { base64: bytes.toString('base64'), signature: encodeBase58(signature) };
}
