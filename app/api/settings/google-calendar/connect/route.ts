import { NextRequest, NextResponse } from 'next/server';
import { getGoogleAuthUrl, isGoogleCalendarConfigured } from '@/lib/google-calendar';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isGoogleCalendarConfigured()) {
    return NextResponse.json({ error: 'Google Calendar is not configured yet (missing GOOGLE_CLIENT_ID/SECRET).' }, { status: 500 });
  }
  // ?return=calendar sends the person back to the Operations Calendar after consent.
  const back = req.nextUrl.searchParams.get('return') === 'calendar' ? 'calendar' : undefined;
  return NextResponse.redirect(getGoogleAuthUrl(back));
}
