import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import {
  getEmployeeDayState, computeDaySummary, eventRequiresSelfie, isTodayFinalized, todayISO,
  type AttendanceEvent,
} from '@/lib/attendance';
import { resolveAttendanceSettings, getActiveEmployeeForUser } from '@/lib/attendance-shifts';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const db = getDb();
  const employee = getActiveEmployeeForUser(db, session.id);
  if (!employee) {
    return NextResponse.json({ error: 'You are not linked to an active employee record. Please contact HR/Admin.' }, { status: 409 });
  }

  const today = todayISO();
  const resolved = resolveAttendanceSettings(db, employee.id, today);
  if (!resolved) return NextResponse.json({ error: 'No shift assigned. Please contact an administrator.' }, { status: 409 });
  const { settings, shift } = resolved;

  const events = db.prepare(`
    SELECT id, event_type, event_time, superseded_by FROM attendance_events
    WHERE employee_id = ? AND event_date = ? AND is_test = 0
    ORDER BY event_time ASC
  `).all(employee.id, today) as AttendanceEvent[];

  const dayState = getEmployeeDayState(events, settings);
  const isFinalized = isTodayFinalized(settings);
  const summary = computeDaySummary(events, settings, isFinalized);

  const otRequest = db.prepare(
    'SELECT status, excess_minutes, approved_minutes FROM attendance_ot_requests WHERE employee_id = ? AND event_date = ?'
  ).get(employee.id, today) as { status: string; excess_minutes: number; approved_minutes: number | null } | undefined;

  const requiresSelfie: Record<string, boolean> = {};
  for (const t of ['TIME_IN', 'TIME_OUT'] as const) requiresSelfie[t] = eventRequiresSelfie(t, settings);

  return NextResponse.json({
    date: today, events, dayState, settings, shift, requiresSelfie, summary, otRequest: otRequest ?? null,
    employee: { id: employee.id, full_name: employee.full_name },
  });
}
