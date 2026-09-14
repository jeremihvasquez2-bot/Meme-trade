// Base58 (Bitcoin alphabet). Solana keys and signatures travel as base58 and
// pulling in a dependency for 40 lines of arithmetic is not worth it.
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const MAP = new Map([...ALPHABET].map((c, i) => [c, i]));

export function encodeBase58(bytes) {
  const input = Uint8Array.from(bytes);
  if (!input.length) return '';
  const digits = [0];
  for (const byte of input) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = '';
  for (let i = 0; input[i] === 0 && i < input.length - 1; i++) out += '1';
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i]];
  return out;
}

export function decodeBase58(str) {
  const text = String(str);
  if (!text.length) return new Uint8Array(0);
  const bytes = [0];
  for (const ch of text) {
    const value = MAP.get(ch);
    if (value === undefined) throw new Error(`invalid base58 character: ${ch}`);
    let carry = value;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let i = 0; text[i] === '1' && i < text.length - 1; i++) bytes.push(0);
  return Uint8Array.from(bytes.reverse());
}

export function isBase58(str, lengths = null) {
  try {
    const bytes = decodeBase58(str);
    return lengths ? lengths.includes(bytes.length) : bytes.length > 0;
  } catch {
    return false;
  }
}
