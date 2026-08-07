import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getEmployeeDayState, todayISO, type AttendanceEvent } from '@/lib/attendance';
import { resolveAttendanceSettings, type Employee } from '@/lib/attendance-shifts';

export const dynamic = 'force-dynamic';

// Live "what is everyone doing right now" view — distinct from the
// shift-status KPIs (Present/Late/Absent/Not Clocked In) already computed
// via /api/attendance/records. Only Active + Attendance Enabled employees
// are considered. Each employee's dayState.state is a single
// mutually-exclusive value (not_started|working|on_lunch|on_coffee|
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
  const today = todayISO();
  const employees = db.prepare(
    "SELECT * FROM employees WHERE employment_status = 'Active' AND attendance_enabled = 1"
  ).all() as Employee[];

  const eventsRaw = db.prepare(`
    SELECT id, employee_id, event_type, event_time, superseded_by FROM attendance_events
    WHERE event_date = ? AND employee_id IN (${employees.map(() => '?').join(',') || '0'}) AND is_test = 0
  `).all(today, ...employees.map(e => e.id)) as (AttendanceEvent & { employee_id: number })[];

  const eventsByEmployee = new Map<number, AttendanceEvent[]>();
  for (const e of eventsRaw) {
    if (!eventsByEmployee.has(e.employee_id)) eventsByEmployee.set(e.employee_id, []);
    eventsByEmployee.get(e.employee_id)!.push(e);
  }

  let working = 0, onBreak = 0, clockedOut = 0, notStarted = 0;
  const employeeStates = employees.map(e => {
    const resolved = resolveAttendanceSettings(db, e.id, today);
    if (!resolved) return { employee_id: e.id, name: e.full_name, state: 'not_started' as const };
    const state = getEmployeeDayState(eventsByEmployee.get(e.id) ?? [], resolved.settings).state;
    if (state === 'working') working++;
    else if (state === 'on_lunch' || state === 'on_coffee') onBreak++;
    else if (state === 'ended') clockedOut++;
    else notStarted++;
    return { employee_id: e.id, name: e.full_name, state };
  });

  return NextResponse.json({ counts: { working, onBreak, clockedOut, notStarted }, employees: employeeStates });
}
