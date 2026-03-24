import { createHmac, timingSafeEqual } from 'crypto';

export function makeSessionToken(): string {
  const secret = process.env.ADMIN_PASSWORD;
  if (!secret) throw new Error('ADMIN_PASSWORD not set');
  return createHmac('sha256', secret).update('palpal-admin-session-v1').digest('hex');
}

export function verifySessionToken(value: string): boolean {
  try {
    const expected = makeSessionToken();
    const a = Buffer.from(value.padEnd(64, '0').slice(0, 64), 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
