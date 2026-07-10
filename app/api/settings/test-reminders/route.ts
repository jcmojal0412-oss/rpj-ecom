import { NextResponse } from 'next/server';
import { checkAndSendReminders } from '@/lib/reminders';

export const dynamic = 'force-dynamic';

// Owner-only manual trigger (gated by middleware's /api/settings _owner rule)
// — lets you force a reminder check right now instead of waiting for the
// automatic 15-minute background cycle.
export async function POST() {
  try {
    const result = await checkAndSendReminders();
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
