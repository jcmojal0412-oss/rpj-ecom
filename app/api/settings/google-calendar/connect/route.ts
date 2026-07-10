import { NextResponse } from 'next/server';
import { getGoogleAuthUrl, isGoogleCalendarConfigured } from '@/lib/google-calendar';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isGoogleCalendarConfigured()) {
    return NextResponse.json({ error: 'Google Calendar is not configured yet (missing GOOGLE_CLIENT_ID/SECRET).' }, { status: 500 });
  }
  return NextResponse.redirect(getGoogleAuthUrl());
}
