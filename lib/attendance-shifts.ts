// DB-touching resolution layer — sits between the API routes and the pure
// computation engine in lib/attendance.ts (which is untouched by this
// file's existence or the employee/shift model; it just consumes whatever
// AttendanceSettings object it receives). Centralizes: loading the global
// break/OT/selfie settings, resolving which shift template + work_days
// applied to a given EMPLOYEE on a given date (history-aware for the
// shift, via attendance_shift_assignments; work_days is a live employee
// field, not historized — see note on getEmployeeAttendanceContext), and
// merging everything into one AttendanceSettings ready for
// computeDaySummary/getEmployeeDayState.
import type Database from 'better-sqlite3';
import { parseAttendanceSettings, type AttendanceSettings } from './attendance';

const GLOBAL_KEYS = [
  'attendance_lunch_break_minutes', 'attendance_coffee_break_minutes', 'attendance_coffee_breaks_allowed',
  'attendance_lunch_break_paid', 'attendance_coffee_break_paid', 'attendance_min_minutes_before_ot',
  'attendance_selfie_required',
];

export interface ShiftTemplate {
  id: number;
  name: string;
  start_time: string;
  end_time: string;
  grace_period_minutes: number;
  active: number;
}

export interface Employee {
  id: number;
  full_name: string;
  employment_status: 'Active' | 'Inactive' | 'Resigned' | 'Terminated';
  attendance_enabled: number;
  linked_user_id: number | null;
  work_days: string; // comma-separated day-of-week numbers
  rest_day: number | null;
}

// The 7 truly-global settings (breaks, OT threshold, selfie). work_days
// moved to being a per-employee field and is no longer part of this.
export function loadGlobalBreakSettings(db: Database.Database): Omit<AttendanceSettings, 'work_start' | 'work_end' | 'grace_period_minutes' | 'work_days'> {
  const rows = db.prepare(
    `SELECT key, value FROM app_settings WHERE key IN (${GLOBAL_KEYS.map(() => '?').join(',')})`
  ).all(...GLOBAL_KEYS) as { key: string; value: string }[];
  const { work_start, work_end, grace_period_minutes, work_days, ...rest } = parseAttendanceSettings(rows);
  return rest;
}

export function getEmployeeById(db: Database.Database, employeeId: number): Employee | null {
  return (db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId) as Employee | undefined) ?? null;
}

// Given a logged-in user's id, finds their linked, active,
// attendance-enabled employee record — the gate every self-service
// attendance action goes through. A system user with no linked employee
// (or a linked-but-inactive/attendance-disabled one) resolves to null and
// must never be able to clock in or appear in any attendance data.
export function getActiveEmployeeForUser(db: Database.Database, userId: number): Employee | null {
  return (db.prepare(`
    SELECT * FROM employees WHERE linked_user_id = ? AND employment_status = 'Active' AND attendance_enabled = 1
  `).get(userId) as Employee | undefined) ?? null;
}

// Identifies an employee at the unauthenticated Attendance Kiosk by
// Employee ID (e.g. "RPJ-0006"), email, or mobile number — the kiosk has no
// login, so this is the entire identification step (the required selfie on
// Time In/Out is the real anti-buddy-punching control, not this lookup).
// Only ever resolves Active + Attendance Enabled employees, same gate as
// getActiveEmployeeForUser, and deliberately returns null (not which field
// almost matched) on any miss so the endpoint can't be used to enumerate
// real emails/mobile numbers.
export function findEmployeeByIdentifier(db: Database.Database, identifierRaw: string): Employee | null {
  const identifier = identifierRaw.trim();
  if (!identifier) return null;

  const eligible = "employment_status = 'Active' AND attendance_enabled = 1";

  const codeMatch = identifier.match(/^RPJ-?0*(\d+)$/i);
  if (codeMatch) {
    const byCode = db.prepare(`SELECT * FROM employees WHERE id = ? AND ${eligible}`).get(Number(codeMatch[1])) as Employee | undefined;
    if (byCode) return byCode;
  }

  if (identifier.includes('@')) {
    const byEmail = db.prepare(`SELECT * FROM employees WHERE email IS NOT NULL AND LOWER(email) = LOWER(?) AND ${eligible}`).get(identifier) as Employee | undefined;
    if (byEmail) return byEmail;
  }

  const digits = identifier.replace(/\D/g, '');
  if (digits.length >= 7) {
    const candidates = db.prepare(`SELECT * FROM employees WHERE mobile_number IS NOT NULL AND ${eligible}`).all() as (Employee & { mobile_number: string })[];
    const byMobile = candidates.find(e => {
      const candidateDigits = e.mobile_number.replace(/\D/g, '');
      return candidateDigits.length >= 7 && (candidateDigits.endsWith(digits) || digits.endsWith(candidateDigits));
    });
    if (byMobile) return byMobile;
  }

  return null;
}

// History-aware: resolves whichever shift was in effect for this employee
// on this specific date, not their current shift. Returns null if there's
// no assignment covering that date. This is the employee's DEFAULT shift —
// assigned once by the admin (via the Employee Profile or Bulk Shift
// Assignment) and applied automatically to every future date without
// needing daily re-assignment. It stays history-aware so reassigning it
// still never rewrites how past dates were computed.
export function getShiftForEmployeeOnDate(db: Database.Database, employeeId: number, date: string): ShiftTemplate | null {
  const assignment = db.prepare(`
    SELECT shift_id FROM attendance_shift_assignments
    WHERE employee_id = ? AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)
    ORDER BY effective_from DESC LIMIT 1
  `).get(employeeId, date, date) as { shift_id: number } | undefined;
  if (!assignment) return null;

  return (db.prepare('SELECT * FROM attendance_shifts WHERE id = ?').get(assignment.shift_id) as ShiftTemplate | undefined) ?? null;
}

// A one-off temporary override for exactly one date (e.g. covering another
// shift for a single day) — separate from the default-shift assignment
// history above, and never mutates it. Returns null if no override exists
// for this exact date.
export function getShiftOverrideForDate(db: Database.Database, employeeId: number, date: string): ShiftTemplate | null {
  const override = db.prepare(`
    SELECT shift_id FROM attendance_shift_overrides WHERE employee_id = ? AND override_date = ?
  `).get(employeeId, date) as { shift_id: number } | undefined;
  if (!override) return null;

  return (db.prepare('SELECT * FROM attendance_shifts WHERE id = ?').get(override.shift_id) as ShiftTemplate | undefined) ?? null;
}

// The shift that actually governs calculations for this employee on this
// date: a date-specific override if one exists, otherwise the employee's
// default shift. This is what every real attendance calculation should
// resolve through — never getShiftForEmployeeOnDate directly — so that late,
// undertime, absence, and potential OT all honor overrides automatically.
export function getEffectiveShiftForDate(db: Database.Database, employeeId: number, date: string): ShiftTemplate | null {
  return getShiftOverrideForDate(db, employeeId, date) ?? getShiftForEmployeeOnDate(db, employeeId, date);
}

export function mergeIntoSettings(
  global: Omit<AttendanceSettings, 'work_start' | 'work_end' | 'grace_period_minutes' | 'work_days'>,
  shift: ShiftTemplate,
  workDays: string
): AttendanceSettings {
  return {
    ...global,
    work_start: shift.start_time,
    work_end: shift.end_time,
    grace_period_minutes: shift.grace_period_minutes,
    work_days: workDays.split(',').filter(Boolean).map(Number),
  };
}

// Convenience one-shot: resolve the employee's shift for this date + their
// current work_days + global breaks/OT/selfie, merged into one
// AttendanceSettings. Returns null if the employee has no shift assignment
// covering that date. Note: work_days is read live off the employee row
// (not historized like the shift) — a work-days change takes effect
// immediately for all dates, current design choice kept simple since the
// user's spec didn't ask for work-days history the way it did for shifts.
export function resolveAttendanceSettings(db: Database.Database, employeeId: number, date: string): { settings: AttendanceSettings; shift: ShiftTemplate; employee: Employee } | null {
  const employee = getEmployeeById(db, employeeId);
  if (!employee) return null;
  const shift = getEffectiveShiftForDate(db, employeeId, date);
  if (!shift) return null;
  const global = loadGlobalBreakSettings(db);
  return { settings: mergeIntoSettings(global, shift, employee.work_days), shift, employee };
}
