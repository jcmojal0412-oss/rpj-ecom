import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { computeDaySummary, isTodayFinalized, todayISO, type AttendanceEvent } from '@/lib/attendance';
import { resolveAttendanceSettings, type Employee } from '@/lib/attendance-shifts';
import { resolveAttendanceException, applyAttendanceException } from '@/lib/attendance-exceptions';

export const dynamic = 'force-dynamic';

// Builds the list of YYYY-MM-DD dates from `from` to `to` inclusive. Uses
// Date.UTC() explicitly rather than `new Date(dateStr + 'T00:00:00')` —
// the latter parses as the SERVER'S LOCAL timezone, which silently shifts
// every date by a day whenever that local zone isn't UTC (e.g. a PH-local
// dev machine, UTC+8) even though production containers are typically UTC.
// Found via Payroll V1 QA, where a non-UTC local run surfaced the drift.
function dateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  let cur = Date.UTC(fy, fm - 1, fd);
  const end = Date.UTC(ty, tm - 1, td);
  while (cur <= end) {
    dates.push(new Date(cur).toISOString().slice(0, 10));
    cur += 86_400_000;
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
    // Every calendar date in range gets a row now (not just configured work
    // days) — a rest day, holiday, or approved-leave day is a real,
    // payroll-relevant status of its own (see lib/attendance-exceptions.ts),
    // not something to silently skip.
    for (const date of allDates) {
      const exception = resolveAttendanceException(db, employee, date);

      // History-aware: resolves whichever shift this employee was actually
      // assigned to on THIS date, not their current shift — so a shift
      // change never rewrites how past dates are computed. A non-work day
      // may have no shift assignment resolvable at all (e.g. before hire),
      // in which case we still want to surface the exception (rest day /
      // holiday / leave) rather than silently dropping the row.
      const resolved = resolveAttendanceSettings(db, employee.id, date);
      const events = eventsByEmployeeDate.get(`${employee.id}|${date}`) ?? [];

      if (!resolved) {
        if (!exception) continue; // no shift AND no exception — genuinely nothing to show
        rows.push({
          employee_id: employee.id, name: employee.full_name, date, shift_name: null,
          status: exception.status, paid: exception.paid, exceptionLabel: exception.label,
          totalWorkMinutes: 0, breakMinutes: 0, excessBreakMinutes: 0, potentialOtMinutes: 0, lateMinutes: 0, undertimeMinutes: 0,
        });
        continue;
      }

      const isFinalized = date < today || (date === today && isTodayFinalized(resolved.settings));
      const rawSummary = computeDaySummary(events, resolved.settings, isFinalized);
      const { status, paid, exceptionLabel } = applyAttendanceException(rawSummary, exception);
      rows.push({
        employee_id: employee.id, name: employee.full_name, date, shift_name: resolved.shift.name,
        ...rawSummary, status, paid, exceptionLabel,
      });
    }
  }

  return NextResponse.json(rows);
}
