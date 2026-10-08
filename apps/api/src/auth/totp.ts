import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(input: Buffer): string {
  let bits = '';
  for (const byte of input) bits += byte.toString(2).padStart(8, '0');
  let output = '';
  for (let index = 0; index < bits.length; index += 5) {
    const chunk = bits.slice(index, index + 5).padEnd(5, '0');
    output += ALPHABET[Number.parseInt(chunk, 2)];
  }
  return output;
}

export function base32Decode(input: string): Buffer {
  const normalized = input.toUpperCase().replace(/=+$/g, '').replace(/\s+/g, '');
  let bits = '';
  for (const char of normalized) {
    const value = ALPHABET.indexOf(char);
    if (value < 0) throw new Error('Base32 secret tidak valid.');
    bits += value.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}

export function generateTotpSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

function hotp(secret: string, counter: number, digits = 6): string {
  const key = base32Decode(secret);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', key).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % (10 ** digits)).padStart(digits, '0');
}

export function verifyTotp(secret: string, code: string, now = Date.now(), window = 1): boolean {
  const normalized = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalized)) return false;
  const counter = Math.floor(now / 30_000);
  const supplied = Buffer.from(normalized, 'utf8');
  for (let drift = -window; drift <= window; drift += 1) {
    const candidate = Buffer.from(hotp(secret, counter + drift), 'utf8');
    if (candidate.length === supplied.length && timingSafeEqual(candidate, supplied)) return true;
  }
  return false;
}

export function buildTotpUri(secret: string, email: string, issuer = 'Toko360'): string {
  const label = `${issuer}:${email}`;
  return `otpauth://totp/${encodeURIComponent(label)}?secret=${encodeURIComponent(secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

export function normalizeRecoveryCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const raw = randomBytes(9).toString('base64url').toUpperCase().replace(/[^A-Z0-9]/g, '').padEnd(12, 'X').slice(0, 12);
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
  });
}
