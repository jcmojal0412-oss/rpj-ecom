import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { parseAttendanceSettings, getEmployeeDayState, todayISO, type AttendanceEvent } from '@/lib/attendance';

export const dynamic = 'force-dynamic';

const ATTENDANCE_KEYS = [
  'attendance_work_start', 'attendance_work_end', 'attendance_grace_period_minutes',
  'attendance_lunch_break_minutes', 'attendance_coffee_break_minutes', 'attendance_coffee_breaks_allowed',
  'attendance_lunch_break_paid', 'attendance_coffee_break_paid', 'attendance_min_minutes_before_ot',
  'attendance_selfie_required', 'attendance_work_days',
];

// Live "what is everyone doing right now" view — distinct from the
// shift-status KPIs (Present/Late/Absent/Not Clocked In) already computed
// via /api/attendance/records. Each active employee's dayState.state is a
// single mutually-exclusive value (not_started|working|on_lunch|on_coffee|
// ended), so an employee is counted in exactly one of these buckets, never
// two — same guarantee the shift-status KPIs already have via
// computeDaySummary's single-status return.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('attendance')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const db = getDb();
  const settingsRows = db.prepare(
    `SELECT key, value FROM app_settings WHERE key IN (${ATTENDANCE_KEYS.map(() => '?').join(',')})`
  ).all(...ATTENDANCE_KEYS) as { key: string; value: string }[];
  const settings = parseAttendanceSettings(settingsRows);

  const today = todayISO();
  const activeUsers = db.prepare('SELECT id, name FROM users WHERE active = 1').all() as { id: number; name: string }[];

  const eventsRaw = db.prepare(`
    SELECT id, user_id, event_type, event_time, superseded_by FROM attendance_events
    WHERE event_date = ? AND user_id IN (${activeUsers.map(() => '?').join(',') || '0'})
  `).all(today, ...activeUsers.map(u => u.id)) as (AttendanceEvent & { user_id: number })[];

  const eventsByUser = new Map<number, AttendanceEvent[]>();
  for (const e of eventsRaw) {
    if (!eventsByUser.has(e.user_id)) eventsByUser.set(e.user_id, []);
    eventsByUser.get(e.user_id)!.push(e);
  }

  let working = 0, onBreak = 0, clockedOut = 0, notStarted = 0;
  const employees = activeUsers.map(u => {
    const state = getEmployeeDayState(eventsByUser.get(u.id) ?? [], settings).state;
    if (state === 'working') working++;
    else if (state === 'on_lunch' || state === 'on_coffee') onBreak++;
    else if (state === 'ended') clockedOut++;
    else notStarted++;
    return { user_id: u.id, name: u.name, state };
  });

  return NextResponse.json({ counts: { working, onBreak, clockedOut, notStarted }, employees });
}
