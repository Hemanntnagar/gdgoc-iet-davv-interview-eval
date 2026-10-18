import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Hash a panel code with the server-side pepper. Plaintext is never stored. */
export function hashPanelCode(code: string, pepper: string): string {
  return createHash('sha256').update(`${pepper}${code}`, 'utf8').digest('hex');
}

/** Constant-time comparison of two hex digests of equal length. */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/** Generate an unambiguous panel code (no 0/O/1/I). Default 8 chars ≈ 32 bits. */
export function generatePanelCode(length = 8): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}
