// Shared clock-event logic used by BOTH the authenticated self-service
// route (/api/attendance/clock, /api/attendance/today) and the
// unauthenticated Attendance Kiosk (/api/attendance-kiosk/*). Exists so the
// kiosk never re-implements the day-state validation or event insertion —
// it only supplies a different (session-less) way of resolving WHICH
// employee is acting. lib/attendance.ts (the pure engine) is never touched
// by this file's existence.
import type Database from 'better-sqlite3';
import {
  getEmployeeDayState, computeDaySummary, eventRequiresSelfie, isTodayFinalized, todayISO,
  type AttendanceEvent, type EventType, type EmployeeDayState,
} from './attendance';
import { resolveAttendanceSettings, type Employee } from './attendance-shifts';

const CAN_FLAG: Record<EventType, keyof EmployeeDayState> = {
  TIME_IN: 'canTimeIn',
  COFFEE_OUT: 'canCoffeeOut',
  COFFEE_IN: 'canCoffeeIn',
  LUNCH_OUT: 'canLunchOut',
  LUNCH_IN: 'canLunchIn',
  TIME_OUT: 'canTimeOut',
};

function loadTodayEvents(db: Database.Database, employeeId: number, date: string): AttendanceEvent[] {
  return db.prepare(`
    SELECT id, event_type, event_time, superseded_by FROM attendance_events
    WHERE employee_id = ? AND event_date = ? AND is_test = 0
    ORDER BY event_time ASC
  `).all(employeeId, date) as AttendanceEvent[];
}

// Everything /api/attendance/today and the kiosk's "who is this / what can
// they do right now" screen need, for one already-resolved employee.
// Returns null if the employee has no shift assignment covering today.
export function getTodayStateForEmployee(db: Database.Database, employee: Employee) {
  const today = todayISO();
  const resolved = resolveAttendanceSettings(db, employee.id, today);
  if (!resolved) return null;
  const { settings, shift } = resolved;

  const events = loadTodayEvents(db, employee.id, today);
  const dayState = getEmployeeDayState(events, settings);
  const isFinalized = isTodayFinalized(settings);
  const summary = computeDaySummary(events, settings, isFinalized);

  const otRequest = db.prepare(
    'SELECT status, excess_minutes, approved_minutes FROM attendance_ot_requests WHERE employee_id = ? AND event_date = ?'
  ).get(employee.id, today) as { status: string; excess_minutes: number; approved_minutes: number | null } | undefined;

  const requiresSelfie: Record<string, boolean> = {};
  for (const t of ['TIME_IN', 'TIME_OUT'] as const) requiresSelfie[t] = eventRequiresSelfie(t, settings);

  return { date: today, events, dayState, settings, shift, requiresSelfie, summary, otRequest: otRequest ?? null };
}

export type ClockResult =
  | { ok: true; dayState: EmployeeDayState; events: AttendanceEvent[] }
  | { error: string; status: number };

// Re-derives the day state server-side and validates the requested action
// against it — never trusts the caller's idea of what state it's in. This
// is what rejects duplicate/out-of-sequence actions (Time In twice,
// exceeding coffee breaks, Time Out from a break, etc.), for both the
// logged-in self-clock route and the kiosk.
//
// actorUserId is whoever should be attributed for the legacy created_by
// column — the session user for self-clock, or null for the kiosk (no
// admin/session is present there). The legacy attendance_events.user_id
// column falls back to the same actorUserId when the employee has no
// linked_user_id (nullable — see the migration in lib/db.ts).
export function recordClockEvent(
  db: Database.Database,
  employee: Employee,
  eventType: EventType,
  photoPath: string | null,
  actorUserId: number | null,
): ClockResult {
  const today = todayISO();
  const resolved = resolveAttendanceSettings(db, employee.id, today);
  if (!resolved) return { error: 'No shift assigned. Please contact an administrator.', status: 409 };
  const { settings } = resolved;

  if (eventRequiresSelfie(eventType, settings) && !photoPath) {
    return { error: 'A selfie photo is required for this action.', status: 400 };
  }

  const events = loadTodayEvents(db, employee.id, today);
  const dayState = getEmployeeDayState(events, settings);
  if (!dayState[CAN_FLAG[eventType]]) {
    return { error: `Cannot record ${eventType} right now (current state: ${dayState.state}).`, status: 409 };
  }

  const eventTime = new Date().toISOString();
  db.prepare(`
    INSERT INTO attendance_events (employee_id, user_id, event_date, event_type, event_time, photo_path, source, created_by)
    VALUES (?, ?, ?, ?, ?, ?, 'clock', ?)
  `).run(employee.id, employee.linked_user_id ?? actorUserId, today, eventType, eventTime, photoPath, actorUserId);

  const updatedEvents = loadTodayEvents(db, employee.id, today);
  return { ok: true, dayState: getEmployeeDayState(updatedEvents, settings), events: updatedEvents };
}
