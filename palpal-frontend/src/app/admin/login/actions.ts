'use server';

import { timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createAdminToken } from '@/lib/auth';

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
  const password = formData.get('password') as string;
  const expected = process.env.ADMIN_PASSWORD;
  if (!password || !expected || !safeCompare(password, expected)) {
    redirect('/admin/login?error=1');
  }
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
