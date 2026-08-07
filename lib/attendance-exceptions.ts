// Attendance Exceptions / Leave Management V1 — a resolution layer that
// sits between the pure computation engine (lib/attendance.ts, which is
// completely untouched by this file) and the API routes. It answers one
// question: "given what computeDaySummary() already computed, should this
// day actually be shown as Absent, or is there an approved reason it
// wasn't worked?" Never runs before the raw engine result, never overrides
// real clock-in data — only ever reclassifies 'not_started' (on a rest
// day) or 'absent' into a more specific, payroll-ready status.
import type Database from 'better-sqlite3';
import type { DaySummary, AttendanceStatus } from './attendance';

export type ExtendedStatus = AttendanceStatus | 'rest_day' | 'on_leave' | 'holiday' | 'official_business';

export interface ExceptionInfo {
  status: 'rest_day' | 'on_leave' | 'holiday' | 'official_business';
  paid: boolean | null;
  label: string;
}

const EXCEPTION_TYPE_LABELS: Record<string, string> = {
  official_business: 'Official Business',
  authorized_absence: 'Authorized Absence',
  company_event: 'Company Event',
};

// Checks, in the exact order required before ever marking someone Absent:
// (1) is this even a scheduled work day, and is it specifically their rest
// day, (2) is there an approved leave covering this date, (3) is there an
// admin-recorded Official Business / Authorized Absence / Company Event
// exception, (4) is it a configured non-working holiday. Returns null if
// none apply — the caller falls back to whatever computeDaySummary()
// actually computed (i.e. a genuine Absent).
export function resolveAttendanceException(
  db: Database.Database,
  employee: { id: number; work_days: string; rest_day: number | null },
  date: string
): ExceptionInfo | null {
  const dow = new Date(date + 'T00:00:00').getDay();
  const workDays = employee.work_days.split(',').filter(Boolean).map(Number);
  const isRestDay = employee.rest_day !== null && Number(employee.rest_day) === dow;
  if (isRestDay || !workDays.includes(dow)) {
    return { status: 'rest_day', paid: null, label: 'Rest Day' };
  }

  const leave = db.prepare(`
    SELECT lt.name as leave_type_name, lt.paid as leave_paid
    FROM leave_requests lr JOIN leave_types lt ON lt.id = lr.leave_type_id
    WHERE lr.employee_id = ? AND lr.status = 'approved' AND ? BETWEEN lr.from_date AND lr.to_date
    LIMIT 1
  `).get(employee.id, date) as { leave_type_name: string; leave_paid: number } | undefined;
  if (leave) return { status: 'on_leave', paid: !!leave.leave_paid, label: leave.leave_type_name };

  const exception = db.prepare(`
    SELECT exception_type, paid FROM attendance_exceptions
    WHERE employee_id = ? AND ? BETWEEN from_date AND to_date
    LIMIT 1
  `).get(employee.id, date) as { exception_type: string; paid: number } | undefined;
  if (exception) {
    return { status: 'official_business', paid: !!exception.paid, label: EXCEPTION_TYPE_LABELS[exception.exception_type] ?? exception.exception_type };
  }

  const holiday = db.prepare(`SELECT name, is_working FROM holidays WHERE date = ?`).get(date) as { name: string; is_working: number } | undefined;
  if (holiday && !holiday.is_working) return { status: 'holiday', paid: null, label: holiday.name };

  return null;
}

// Real clock-in data always wins — exceptions only ever reclassify a day
// that would otherwise show as 'absent', or (for a rest day specifically)
// 'not_started', since there's no expectation to clock in at all that day.
// Every other in-progress state (still 'not_started' on a real work day,
// still within the shift window) is left alone: an exception isn't known
// to apply yet and shouldn't be guessed at before the day even closes.
export function applyAttendanceException(
  rawSummary: DaySummary,
  exception: ExceptionInfo | null
): { status: ExtendedStatus; paid: boolean | null; exceptionLabel: string | null } {
  if (rawSummary.status !== 'not_started' && rawSummary.status !== 'absent') {
    return { status: rawSummary.status, paid: null, exceptionLabel: null };
  }
  if (exception?.status === 'rest_day') {
    return { status: 'rest_day', paid: exception.paid, exceptionLabel: exception.label };
  }
  if (rawSummary.status === 'not_started') {
    return { status: 'not_started', paid: null, exceptionLabel: null };
  }
  if (exception) {
    return { status: exception.status, paid: exception.paid, exceptionLabel: exception.label };
  }
  return { status: 'absent', paid: false, exceptionLabel: null };
}
