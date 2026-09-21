import { getDb } from './db';
import { computeDaySummary, isTodayFinalized, isConfiguredWorkDay, type AttendanceEvent } from './attendance';
import { resolveAttendanceSettings, type Employee } from './attendance-shifts';
import { resolveAttendanceException } from './attendance-exceptions';

function phDateNDaysAgo(n: number): string {
  const d = new Date(Date.now() + 8 * 3600 * 1000 - n * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function activeAttendanceEmployees(db: ReturnType<typeof getDb>): Employee[] {
  return db.prepare(`
    SELECT * FROM employees WHERE employment_status = 'Active' AND attendance_enabled = 1
  `).all() as Employee[];
}

function parseWorkDays(employee: Employee): { work_days: number[] } {
  return { work_days: employee.work_days.split(',').filter(Boolean).map(Number) };
}

// How far back the flagger looks. It used to cover only today + yesterday,
// so any day it missed (app restarted, time-out corrected later, shift
// assigned late) kept showing "Potential OT pending" in Daily Records with no
// request behind it - nothing to review, nothing that could ever reach
// payroll. Requests are idempotent per (employee, date), so a wide window
// only ever fills gaps.
const OT_LOOKBACK_DAYS = 45;

// Creates the "Potential OT - Pending Approval" request for ONE employee/day
// if it qualifies (Time Out recorded, excess minutes - measured against the
// EMPLOYEE'S OWN ASSIGNED SHIFT end time for that date - clear the configured
// threshold, and no request exists yet). Returns true when a new request was
// created. Only ever writes status='pending' with approved_minutes NULL.
function flagOvertimeForDay(db: ReturnType<typeof getDb>, employee: Employee, date: string): boolean {
  if (!isConfiguredWorkDay(date, parseWorkDays(employee))) return false;

  const hasTimeOut = db.prepare(`
    SELECT 1 FROM attendance_events
    WHERE employee_id = ? AND event_date = ? AND event_type = 'TIME_OUT' AND superseded_by IS NULL AND is_test = 0
    LIMIT 1
  `).get(employee.id, date);
  if (!hasTimeOut) return false;

  const existing = db.prepare('SELECT id FROM attendance_ot_requests WHERE employee_id = ? AND event_date = ?').get(employee.id, date);
  if (existing) return false;

  const resolved = resolveAttendanceSettings(db, employee.id, date);
  if (!resolved) return false; // no shift assignment covering this date

  const events = db.prepare(`
    SELECT id, event_type, event_time, superseded_by FROM attendance_events
    WHERE employee_id = ? AND event_date = ? AND is_test = 0 ORDER BY event_time ASC
  `).all(employee.id, date) as AttendanceEvent[];

  const summary = computeDaySummary(events, resolved.settings, true);
  if (summary.potentialOtMinutes <= 0) return false;

  const timeOutEvent = events.filter(e => e.event_type === 'TIME_OUT' && !e.superseded_by).pop();
  // user_id is a legacy column nothing reads anymore (now nullable -
  // see the attendance_ot_requests rebuild in lib/db.ts). The real
  // idempotency guard is idx_attendance_ot_employee_date on
  // (employee_id, event_date), not this column.
  const info = db.prepare(`
    INSERT OR IGNORE INTO attendance_ot_requests (employee_id, user_id, event_date, time_out_event_id, excess_minutes, status)
    VALUES (?, ?, ?, ?, ?, 'pending')
  `).run(employee.id, employee.linked_user_id ?? null, date, timeOutEvent?.id ?? null, summary.potentialOtMinutes);
  return info.changes > 0;
}

// Nothing here (or anywhere else in the codebase) sets status='approved'
// automatically or touches payroll - approved_minutes stays NULL until a
// manager reviews it. Only Active + Attendance Enabled employees are
// considered.
export function flagPotentialOvertime(): number {
  const db = getDb();
  const employees = activeAttendanceEmployees(db);
  let flagged = 0;

  for (let daysAgo = 0; daysAgo < OT_LOOKBACK_DAYS; daysAgo++) {
    const date = phDateNDaysAgo(daysAgo);
    for (const employee of employees) {
      if (flagOvertimeForDay(db, employee, date)) flagged++;
    }
  }

  return flagged;
}

// Used by Daily Records: the "Potential OT" figure there is computed live,
// so a day older than the lookback (or one the job hasn't reached yet) may
// have no request row. This creates it on demand - computed server-side from
// the real punches, never from a client-supplied number - and returns the
// request either way, or null if the day doesn't qualify for OT.
export function ensureOvertimeRequest(employeeId: number, date: string): Record<string, unknown> | null {
  const db = getDb();
  const employee = db.prepare(
    "SELECT * FROM employees WHERE id = ? AND employment_status = 'Active' AND attendance_enabled = 1"
  ).get(employeeId) as Employee | undefined;
  if (!employee) return null;

  flagOvertimeForDay(db, employee, date);
  const row = db.prepare(`
    SELECT o.*, e.full_name AS employee_name FROM attendance_ot_requests o
    JOIN employees e ON e.id = o.employee_id
    WHERE o.employee_id = ? AND o.event_date = ?
  `).get(employeeId, date) as Record<string, unknown> | undefined;
  return row ?? null;
}

// Marks a durable "system flagged this" trail once EACH EMPLOYEE'S OWN
// SHIFT window has truly closed — different shifts end at different
// times, so this check runs per-employee rather than against one global
// cutoff. Only considers Active + Attendance Enabled employees. Live
// Absent status shown on the Dashboard/Records pages is always derived
// fresh from computeDaySummary(), not read from this log. Idempotent via
// the partial unique index on (target_employee_id, event_date,
// action='auto_absent').
export function markAbsentees(): number {
  const db = getDb();
  const today = phDateNDaysAgo(0);
  const employees = activeAttendanceEmployees(db);
  let flagged = 0;

  for (const employee of employees) {
    if (!isConfiguredWorkDay(today, parseWorkDays(employee))) continue;

    const resolved = resolveAttendanceSettings(db, employee.id, today);
    if (!resolved) continue; // no shift assignment covering today
    if (!isTodayFinalized(resolved.settings)) continue; // this employee's own shift window hasn't closed yet

    const hasTimeIn = db.prepare(`
      SELECT 1 FROM attendance_events
      WHERE employee_id = ? AND event_date = ? AND event_type = 'TIME_IN' AND superseded_by IS NULL AND is_test = 0
      LIMIT 1
    `).get(employee.id, today);
    if (hasTimeIn) continue;

    // Before flagging: an approved leave, an admin-recorded exception
    // (Official Business / Authorized Absence / Company Event), or a
    // non-working holiday all mean this is NOT an unexplained no-show —
    // never write an auto_absent audit row for a day that's already
    // accounted for.
    if (resolveAttendanceException(db, employee, today)) continue;

    const info = db.prepare(`
      INSERT OR IGNORE INTO attendance_audit_log (actor_user_id, action, employee_id, event_date, details)
      VALUES (NULL, 'auto_absent', ?, ?, 'Auto-flagged: no Time In recorded by end of assigned shift')
    `).run(employee.id, today);
    if (info.changes > 0) flagged++;
  }

  return flagged;
}

export async function runAttendanceJobs(): Promise<{ otFlagged: number; absencesFlagged: number }> {
  return { otFlagged: flagPotentialOvertime(), absencesFlagged: markAbsentees() };
}
