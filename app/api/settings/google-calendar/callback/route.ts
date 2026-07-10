import { NextRequest, NextResponse } from 'next/server';
import { exchangeCodeForTokens, saveGoogleCalendarConnection } from '@/lib/google-calendar';

export const dynamic = 'force-dynamic';

// Railway's internal request URL reports the container's local address
// (e.g. http://localhost:8080), not the public domain — building redirects
// from req.url sends the browser to an unreachable address. Use the known
// public site origin instead (same fallback as GOOGLE_REDIRECT_URI).
const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://rpjcorp.com';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const error = req.nextUrl.searchParams.get('error');
  const redirectTo = new URL('/sedo-bookings', SITE_ORIGIN);

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
