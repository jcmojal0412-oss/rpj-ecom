import { NextRequest, NextResponse } from 'next/server';
import { exchangeCodeForTokens, saveGoogleCalendarConnection } from '@/lib/google-calendar';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const error = req.nextUrl.searchParams.get('error');
  const redirectTo = new URL('/discovery-calls', req.url);

  if (error || !code) {
    redirectTo.searchParams.set('gcal', 'error');
    return NextResponse.redirect(redirectTo);
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.refresh_token) {
      // Google only issues a refresh_token on first-time consent; prompt=consent
      // in getGoogleAuthUrl() forces this on every connect, but guard anyway.
      redirectTo.searchParams.set('gcal', 'error');
      return NextResponse.redirect(redirectTo);
    }
    await saveGoogleCalendarConnection(tokens.refresh_token, tokens.access_token);
    redirectTo.searchParams.set('gcal', 'connected');
  } catch (e) {
    console.error('[google-calendar] callback failed:', e);
    redirectTo.searchParams.set('gcal', 'error');
  }

  return NextResponse.redirect(redirectTo);
}
