import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { computeDaySummary, isTodayFinalized, isConfiguredWorkDay, todayISO, type AttendanceEvent } from '@/lib/attendance';
import { resolveAttendanceSettings, type Employee } from '@/lib/attendance-shifts';

export const dynamic = 'force-dynamic';

function dateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  let cur = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur = new Date(cur.getTime() + 86_400_000);
  }
  return dates;
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('attendance')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const from = req.nextUrl.searchParams.get('from');
  const to = req.nextUrl.searchParams.get('to');
  const employeeIdParam = req.nextUrl.searchParams.get('employee_id');
  if (!from || !to) return NextResponse.json({ error: 'from and to are required' }, { status: 400 });

  const db = getDb();

  // Only Active + Attendance Enabled employees ever appear in attendance
  // reports — a system user with no linked employee record (or an
  // inactive/disabled one) never shows up here, regardless of their
  // `users.active` flag.
  const employees = (employeeIdParam
    ? db.prepare("SELECT * FROM employees WHERE id = ? AND employment_status = 'Active' AND attendance_enabled = 1").all(Number(employeeIdParam))
    : db.prepare("SELECT * FROM employees WHERE employment_status = 'Active' AND attendance_enabled = 1 ORDER BY full_name ASC").all()) as Employee[];

  if (!employees.length) return NextResponse.json([]);
  const employeeIds = employees.map(e => e.id);

  const eventsRaw = db.prepare(`
    SELECT id, employee_id, event_date, event_type, event_time, superseded_by
    FROM attendance_events
    WHERE event_date BETWEEN ? AND ? AND employee_id IN (${employeeIds.map(() => '?').join(',')}) AND is_test = 0
    ORDER BY event_time ASC
  `).all(from, to, ...employeeIds) as (AttendanceEvent & { employee_id: number; event_date: string })[];

  const eventsByEmployeeDate = new Map<string, AttendanceEvent[]>();
  for (const e of eventsRaw) {
    const key = `${e.employee_id}|${e.event_date}`;
    if (!eventsByEmployeeDate.has(key)) eventsByEmployeeDate.set(key, []);
    eventsByEmployeeDate.get(key)!.push(e);
  }

  const today = todayISO();
  const allDates = dateRange(from, to);
  const rows: any[] = [];

  for (const employee of employees) {
    // work_days is per-employee now, so the date filter runs per employee,
    // not once for the whole range.
    const dates = allDates.filter(d => isConfiguredWorkDay(d, { work_days: employee.work_days.split(',').filter(Boolean).map(Number) }));
    for (const date of dates) {
      // History-aware: resolves whichever shift this employee was actually
      // assigned to on THIS date, not their current shift — so a shift
      // change never rewrites how past dates are computed.
      const resolved = resolveAttendanceSettings(db, employee.id, date);
      if (!resolved) continue; // no shift assignment covering this date — nothing to compute

      const events = eventsByEmployeeDate.get(`${employee.id}|${date}`) ?? [];
      const isFinalized = date < today || (date === today && isTodayFinalized(resolved.settings));
      const summary = computeDaySummary(events, resolved.settings, isFinalized);
      rows.push({ employee_id: employee.id, name: employee.full_name, date, shift_name: resolved.shift.name, ...summary });
    }
  }

  return NextResponse.json(rows);
}
