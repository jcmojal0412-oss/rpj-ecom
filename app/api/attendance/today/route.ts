import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { parseAttendanceSettings, getEmployeeDayState, eventRequiresSelfie, todayISO, type AttendanceEvent } from '@/lib/attendance';

export const dynamic = 'force-dynamic';

const ATTENDANCE_KEYS = [
  'attendance_work_start', 'attendance_work_end', 'attendance_grace_period_minutes',
  'attendance_lunch_break_minutes', 'attendance_coffee_break_minutes', 'attendance_coffee_breaks_allowed',
  'attendance_lunch_break_paid', 'attendance_coffee_break_paid', 'attendance_min_minutes_before_ot',
  'attendance_selfie_required', 'attendance_work_days',
];

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const db = getDb();
  const settingsRows = db.prepare(
    `SELECT key, value FROM app_settings WHERE key IN (${ATTENDANCE_KEYS.map(() => '?').join(',')})`
  ).all(...ATTENDANCE_KEYS) as { key: string; value: string }[];
  const settings = parseAttendanceSettings(settingsRows);

  const today = todayISO();
  const events = db.prepare(`
    SELECT id, event_type, event_time, superseded_by FROM attendance_events
    WHERE user_id = ? AND event_date = ?
    ORDER BY event_time ASC
  `).all(session.id, today) as AttendanceEvent[];

  const dayState = getEmployeeDayState(events, settings);

  const requiresSelfie: Record<string, boolean> = {};
  for (const t of ['TIME_IN', 'TIME_OUT'] as const) requiresSelfie[t] = eventRequiresSelfie(t, settings);

  return NextResponse.json({ date: today, events, dayState, settings, requiresSelfie });
}
