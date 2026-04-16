import { NextRequest, NextResponse } from 'next/server';

const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || 'byquinny2026').trim();
const COOKIE_NAME = 'bq_admin_auth';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only protect /admin routes
  if (!pathname.startsWith('/admin')) {
    return NextResponse.next();
  }

  // Allow login page through
  if (pathname === '/admin/login') {
    return NextResponse.next();
  }

  // Check auth cookie
  const authCookie = request.cookies.get(COOKIE_NAME);
  if (authCookie?.value === ADMIN_PASSWORD) {
    return NextResponse.next();
  }

  // Redirect to login
  const loginUrl = new URL('/admin/login', request.url);
  loginUrl.searchParams.set('from', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/admin/((?!login|api).*)'],
};
