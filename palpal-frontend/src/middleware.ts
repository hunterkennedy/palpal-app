import { NextRequest, NextResponse } from 'next/server';

const SESSION_COOKIE = 'palpal_admin_session';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === '/admin/login' || pathname === '/admin/logout') {
    return NextResponse.next();
  }

  // Edge Runtime can't access runtime env vars, so we check cookie existence
  // here and do the full token validation in the route handlers (Node.js runtime).
  const session = request.cookies.get(SESSION_COOKIE);
  if (!session?.value) {
    return NextResponse.redirect(new URL('/admin/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin', '/admin/:path*'],
};
