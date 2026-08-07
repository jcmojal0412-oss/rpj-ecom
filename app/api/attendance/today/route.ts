import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import {
  getEmployeeDayState, computeDaySummary, eventRequiresSelfie, isTodayFinalized, todayISO,
  type AttendanceEvent,
} from '@/lib/attendance';
import { resolveAttendanceSettings } from '@/lib/attendance-shifts';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const db = getDb();
  const today = todayISO();

  const resolved = resolveAttendanceSettings(db, session.id, today);
  if (!resolved) return NextResponse.json({ error: 'No shift assigned. Please contact an administrator.' }, { status: 409 });
  const { settings, shift } = resolved;

  const events = db.prepare(`
    SELECT id, event_type, event_time, superseded_by FROM attendance_events
    WHERE user_id = ? AND event_date = ? AND is_test = 0
    ORDER BY event_time ASC
  `).all(session.id, today) as AttendanceEvent[];

  const dayState = getEmployeeDayState(events, settings);
  const isFinalized = isTodayFinalized(settings);
  const summary = computeDaySummary(events, settings, isFinalized);

  const otRequest = db.prepare(
    'SELECT status, excess_minutes, approved_minutes FROM attendance_ot_requests WHERE user_id = ? AND event_date = ?'
  ).get(session.id, today) as { status: string; excess_minutes: number; approved_minutes: number | null } | undefined;

  const requiresSelfie: Record<string, boolean> = {};
  for (const t of ['TIME_IN', 'TIME_OUT'] as const) requiresSelfie[t] = eventRequiresSelfie(t, settings);

  return NextResponse.json({ date: today, events, dayState, settings, shift, requiresSelfie, summary, otRequest: otRequest ?? null });
}
