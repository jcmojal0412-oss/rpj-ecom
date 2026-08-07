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

// History-aware: resolves whichever shift was in effect for this employee
// on this specific date, not their current shift. Returns null if there's
// no assignment covering that date.
export function getShiftForEmployeeOnDate(db: Database.Database, employeeId: number, date: string): ShiftTemplate | null {
  const assignment = db.prepare(`
    SELECT shift_id FROM attendance_shift_assignments
    WHERE employee_id = ? AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)
    ORDER BY effective_from DESC LIMIT 1
  `).get(employeeId, date, date) as { shift_id: number } | undefined;
  if (!assignment) return null;

  return (db.prepare('SELECT * FROM attendance_shifts WHERE id = ?').get(assignment.shift_id) as ShiftTemplate | undefined) ?? null;
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
  const shift = getShiftForEmployeeOnDate(db, employeeId, date);
  if (!shift) return null;
  const global = loadGlobalBreakSettings(db);
  return { settings: mergeIntoSettings(global, shift, employee.work_days), shift, employee };
}
