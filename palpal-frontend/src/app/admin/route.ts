import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyAdminToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = (await cookies()).get('palpal_admin_session');
  if (!session || !(await verifyAdminToken(session.value))) {
    redirect('/admin/login');
  }
  const html = readFileSync(join(process.cwd(), 'src/app/admin/panel.html'), 'utf-8');
  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
