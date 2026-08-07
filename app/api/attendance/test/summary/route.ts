import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { parseAttendanceSettings, computeDaySummary, todayISO, type AttendanceEvent } from '@/lib/attendance';

export const dynamic = 'force-dynamic';

const ATTENDANCE_KEYS = [
  'attendance_work_start', 'attendance_work_end', 'attendance_grace_period_minutes',
  'attendance_lunch_break_minutes', 'attendance_coffee_break_minutes', 'attendance_coffee_breaks_allowed',
  'attendance_lunch_break_paid', 'attendance_coffee_break_paid', 'attendance_min_minutes_before_ot',
  'attendance_selfie_required', 'attendance_work_days',
];

// Preview-only: computes the same DaySummary a real report would, but
// sourced ONLY from is_test = 1 rows for the given employee/date — never
// touches or is touched by /api/attendance/records (the real report),
// which explicitly excludes is_test = 1.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('attendance')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const userId = req.nextUrl.searchParams.get('user_id');
  const date = req.nextUrl.searchParams.get('date');
  if (!userId || !date) return NextResponse.json({ error: 'user_id and date are required' }, { status: 400 });

  const db = getDb();
  const settingsRows = db.prepare(
    `SELECT key, value FROM app_settings WHERE key IN (${ATTENDANCE_KEYS.map(() => '?').join(',')})`
  ).all(...ATTENDANCE_KEYS) as { key: string; value: string }[];
  const settings = parseAttendanceSettings(settingsRows);

  const events = db.prepare(`
    SELECT id, event_type, event_time, superseded_by FROM attendance_events
    WHERE user_id = ? AND event_date = ? AND is_test = 1
    ORDER BY event_time ASC
  `).all(userId, date) as AttendanceEvent[];

  // Treat any date other than "today" as finalized (a simulated past/future
  // day is always a complete, closed day for preview purposes).
  const isFinalized = date !== todayISO() || events.some(e => e.event_type === 'TIME_OUT');
  const summary = computeDaySummary(events, settings, isFinalized);

  return NextResponse.json({ summary, isFinalized });
}
