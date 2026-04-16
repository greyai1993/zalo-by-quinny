import { NextRequest, NextResponse } from 'next/server';

const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || 'byquinny2026').trim();
const COOKIE_NAME = 'bq_admin_auth';

export async function POST(request: NextRequest) {
  const { password } = await request.json();

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, ADMIN_PASSWORD, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/',
  });

  return response;
}
