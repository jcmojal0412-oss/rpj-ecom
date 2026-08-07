// DB-touching shift resolution layer — sits between the API routes and the
// pure computation engine in lib/attendance.ts (which is untouched by this
// file's existence; it just consumes whatever AttendanceSettings object it
// receives). Centralizes: loading the global break/OT/selfie/work-days
// settings, resolving which shift template applied to a given employee on
// a given date (history-aware, via attendance_shift_assignments), and
// merging the two into one AttendanceSettings ready for computeDaySummary/
// getEmployeeDayState.
import type Database from 'better-sqlite3';
import { parseAttendanceSettings, type AttendanceSettings } from './attendance';

const GLOBAL_KEYS = [
  'attendance_lunch_break_minutes', 'attendance_coffee_break_minutes', 'attendance_coffee_breaks_allowed',
  'attendance_lunch_break_paid', 'attendance_coffee_break_paid', 'attendance_min_minutes_before_ot',
  'attendance_selfie_required', 'attendance_work_days',
];

export interface ShiftTemplate {
  id: number;
  name: string;
  start_time: string;
  end_time: string;
  grace_period_minutes: number;
  active: number;
}

// The 8 non-shift settings, shared by every employee regardless of shift.
export function loadGlobalBreakSettings(db: Database.Database): Omit<AttendanceSettings, 'work_start' | 'work_end' | 'grace_period_minutes'> {
  const rows = db.prepare(
    `SELECT key, value FROM app_settings WHERE key IN (${GLOBAL_KEYS.map(() => '?').join(',')})`
  ).all(...GLOBAL_KEYS) as { key: string; value: string }[];
  // parseAttendanceSettings defaults work_start/work_end/grace_period_minutes
  // when their keys aren't in the row set (as here) — those 3 fields are
  // simply discarded below, the caller always overrides them from the
  // resolved shift.
  const { work_start, work_end, grace_period_minutes, ...rest } = parseAttendanceSettings(rows);
  return rest;
}

// History-aware: resolves whichever shift was in effect for this user on
// this specific date, not their current shift. Returns null if the user
// has no assignment covering that date (shouldn't normally happen — every
// user gets a default assignment at creation/migration time — callers
// should treat null as "not schedulable, skip this user/date").
export function getShiftForUserOnDate(db: Database.Database, userId: number, date: string): ShiftTemplate | null {
  const assignment = db.prepare(`
    SELECT shift_id FROM attendance_shift_assignments
    WHERE user_id = ? AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)
    ORDER BY effective_from DESC LIMIT 1
  `).get(userId, date, date) as { shift_id: number } | undefined;
  if (!assignment) return null;

  return (db.prepare('SELECT * FROM attendance_shifts WHERE id = ?').get(assignment.shift_id) as ShiftTemplate | undefined) ?? null;
}

export function mergeShiftIntoSettings(
  global: Omit<AttendanceSettings, 'work_start' | 'work_end' | 'grace_period_minutes'>,
  shift: ShiftTemplate
): AttendanceSettings {
  return {
    ...global,
    work_start: shift.start_time,
    work_end: shift.end_time,
    grace_period_minutes: shift.grace_period_minutes,
  };
}

// Convenience one-shot: resolve + merge. Returns null if the user has no
// shift assignment covering that date.
export function resolveAttendanceSettings(db: Database.Database, userId: number, date: string): { settings: AttendanceSettings; shift: ShiftTemplate } | null {
  const shift = getShiftForUserOnDate(db, userId, date);
  if (!shift) return null;
  const global = loadGlobalBreakSettings(db);
  return { settings: mergeShiftIntoSettings(global, shift), shift };
}
