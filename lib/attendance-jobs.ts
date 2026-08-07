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

// Flags "Potential OT – Pending Approval" once a Time Out is recorded and
// the excess minutes (measured against the EMPLOYEE'S OWN ASSIGNED SHIFT
// end time, resolved for that specific date) clear the configured
// threshold. This only ever writes to attendance_ot_requests with
// status='pending' — nothing here (or anywhere else in the codebase) sets
// status='approved' automatically or touches payroll. approved_minutes
// stays NULL until a manager reviews it via the OT Approval Queue. Only
// considers employees who are Active + Attendance Enabled — a system user
// with no linked employee (or an inactive one) never gets flagged.
export function flagPotentialOvertime(): number {
  const db = getDb();
  const employees = activeAttendanceEmployees(db);
  let flagged = 0;

  for (const date of [phDateNDaysAgo(0), phDateNDaysAgo(1)]) {
    for (const employee of employees) {
      if (!isConfiguredWorkDay(date, parseWorkDays(employee))) continue;

      const hasTimeOut = db.prepare(`
        SELECT 1 FROM attendance_events
        WHERE employee_id = ? AND event_date = ? AND event_type = 'TIME_OUT' AND superseded_by IS NULL AND is_test = 0
        LIMIT 1
      `).get(employee.id, date);
      if (!hasTimeOut) continue;

      const existing = db.prepare('SELECT id FROM attendance_ot_requests WHERE employee_id = ? AND event_date = ?').get(employee.id, date);
      if (existing) continue;

      const resolved = resolveAttendanceSettings(db, employee.id, date);
      if (!resolved) continue; // no shift assignment covering this date

      const events = db.prepare(`
        SELECT id, event_type, event_time, superseded_by FROM attendance_events
        WHERE employee_id = ? AND event_date = ? AND is_test = 0 ORDER BY event_time ASC
      `).all(employee.id, date) as AttendanceEvent[];

      const summary = computeDaySummary(events, resolved.settings, true);
      if (summary.potentialOtMinutes <= 0) continue;

      const timeOutEvent = events.filter(e => e.event_type === 'TIME_OUT' && !e.superseded_by).pop();
      // user_id is a legacy NOT NULL column nothing reads anymore, but the
      // table still has a UNIQUE(user_id, event_date) constraint from
      // before employees existed — when there's no linked user, use
      // -employee.id as the sentinel (always negative, so it can never
      // collide with a real positive user id, AND is unique per employee,
      // so two unlinked employees on the same date don't collide with
      // each other and silently suppress one another's OT flag).
      const info = db.prepare(`
        INSERT OR IGNORE INTO attendance_ot_requests (employee_id, user_id, event_date, time_out_event_id, excess_minutes, status)
        VALUES (?, ?, ?, ?, ?, 'pending')
      `).run(employee.id, employee.linked_user_id ?? -employee.id, date, timeOutEvent?.id ?? null, summary.potentialOtMinutes);
      if (info.changes > 0) flagged++;
    }
  }

  return flagged;
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
