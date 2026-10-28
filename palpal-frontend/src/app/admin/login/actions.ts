'use server';

import { timingSafeEqual } from 'crypto';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createAdminToken } from '@/lib/auth';
import { checkAdminRateLimit, resetAdminRateLimit } from '@/lib/adminRateLimit';

function clientIpFromHeaders(h: Headers): string {
  const xff = h.get('x-forwarded-for');
  if (xff) {
    const hops = xff.split(',').map((hop) => hop.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }
  return h.get('x-real-ip') || 'anonymous';
}

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Still run a same-length comparison so a length mismatch doesn't return
    // early faster than a full compare would (avoids a length-based timing tell).
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export async function loginAction(formData: FormData) {
  const requestHeaders = await headers();
  const rateKey = `admin:login:${clientIpFromHeaders(requestHeaders)}`;
  const attempt = checkAdminRateLimit(rateKey, 8, 15 * 60_000);
  if (!attempt.ok) {
    redirect('/admin/login?error=rate');
  }

  const password = formData.get('password') as string;
  const expected = process.env.ADMIN_PASSWORD;
  if (!password || !expected || !safeCompare(password, expected)) {
    redirect('/admin/login?error=1');
  }
  resetAdminRateLimit(rateKey);

  const token = await createAdminToken();
  (await cookies()).set('palpal_admin_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  });
  redirect('/admin');
}
