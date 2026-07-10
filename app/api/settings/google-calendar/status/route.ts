import { NextResponse } from 'next/server';
import { isGoogleCalendarConnected, getConnectedGoogleEmail, isGoogleCalendarConfigured } from '@/lib/google-calendar';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    configured: isGoogleCalendarConfigured(),
    connected: isGoogleCalendarConnected(),
    email: getConnectedGoogleEmail(),
  });
}
