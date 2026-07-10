import { NextResponse } from 'next/server';
import { disconnectGoogleCalendar } from '@/lib/google-calendar';

export const dynamic = 'force-dynamic';

export async function POST() {
  disconnectGoogleCalendar();
  return NextResponse.json({ ok: true });
}
