import { getDb } from './db';
import {
  parseAttendanceSettings, computeDaySummary, isConfiguredWorkDay, isTodayFinalized,
  type AttendanceEvent,
} from './attendance';

const ATTENDANCE_KEYS = [
  'attendance_work_start', 'attendance_work_end', 'attendance_grace_period_minutes',
  'attendance_lunch_break_minutes', 'attendance_coffee_break_minutes', 'attendance_coffee_breaks_allowed',
  'attendance_lunch_break_paid', 'attendance_coffee_break_paid', 'attendance_min_minutes_before_ot',
  'attendance_selfie_required', 'attendance_work_days',
];

function loadSettings() {
  const db = getDb();
  const rows = db.prepare(
    `SELECT key, value FROM app_settings WHERE key IN (${ATTENDANCE_KEYS.map(() => '?').join(',')})`
  ).all(...ATTENDANCE_KEYS) as { key: string; value: string }[];
  return parseAttendanceSettings(rows);
}

function phDateNDaysAgo(n: number): string {
  const d = new Date(Date.now() + 8 * 3600 * 1000 - n * 86_400_000);
  return d.toISOString().slice(0, 10);
}

// Flags "Potential OT – Pending Approval" once a Time Out is recorded and
// the excess minutes clear the configured threshold. This only ever writes
// to attendance_ot_requests with status='pending' — nothing here (or
// anywhere else in the codebase) sets status='approved' automatically or
// touches payroll. approved_minutes stays NULL until a manager reviews it
// via the OT Approval Queue.
export function flagPotentialOvertime(): number {
  const db = getDb();
  const settings = loadSettings();
  let flagged = 0;

  for (const date of [phDateNDaysAgo(0), phDateNDaysAgo(1)]) {
    if (!isConfiguredWorkDay(date, settings)) continue;

    const usersWithTimeOut = db.prepare(`
      SELECT DISTINCT user_id FROM attendance_events
      WHERE event_date = ? AND event_type = 'TIME_OUT' AND superseded_by IS NULL AND is_test = 0
    `).all(date) as { user_id: number }[];

    for (const { user_id } of usersWithTimeOut) {
      const existing = db.prepare('SELECT id FROM attendance_ot_requests WHERE user_id = ? AND event_date = ?').get(user_id, date);
      if (existing) continue;

      const events = db.prepare(`
        SELECT id, event_type, event_time, superseded_by FROM attendance_events
        WHERE user_id = ? AND event_date = ? AND is_test = 0 ORDER BY event_time ASC
      `).all(user_id, date) as AttendanceEvent[];

      const summary = computeDaySummary(events, settings, true);
      if (summary.potentialOtMinutes <= 0) continue;

      const timeOutEvent = events.filter(e => e.event_type === 'TIME_OUT' && !e.superseded_by).pop();
      const info = db.prepare(`
        INSERT OR IGNORE INTO attendance_ot_requests (user_id, event_date, time_out_event_id, excess_minutes, status)
        VALUES (?, ?, ?, ?, 'pending')
      `).run(user_id, date, timeOutEvent?.id ?? null, summary.potentialOtMinutes);
      if (info.changes > 0) flagged++;
    }
  }

  return flagged;
}

// Marks a durable "system flagged this" trail once the shift window has
// truly closed (isTodayFinalized) — live Absent status shown on the
// Dashboard/Records pages is always derived fresh from
// computeDaySummary(), not read from this log. Idempotent via the partial
// unique index on (target_user_id, event_date, action='auto_absent').
export function markAbsentees(): number {
  const db = getDb();
  const settings = loadSettings();
  if (!isTodayFinalized(settings)) return 0;

  const today = phDateNDaysAgo(0);
  if (!isConfiguredWorkDay(today, settings)) return 0;

  const activeUsers = db.prepare('SELECT id FROM users WHERE active = 1').all() as { id: number }[];
  let flagged = 0;

  for (const { id: userId } of activeUsers) {
    const hasTimeIn = db.prepare(`
      SELECT 1 FROM attendance_events
      WHERE user_id = ? AND event_date = ? AND event_type = 'TIME_IN' AND superseded_by IS NULL AND is_test = 0
      LIMIT 1
    `).get(userId, today);
    if (hasTimeIn) continue;

    const info = db.prepare(`
      INSERT OR IGNORE INTO attendance_audit_log (actor_user_id, action, target_user_id, event_date, details)
      VALUES (NULL, 'auto_absent', ?, ?, 'Auto-flagged: no Time In recorded by end of work day')
    `).run(userId, today);
    if (info.changes > 0) flagged++;
  }

  return flagged;
}

export async function runAttendanceJobs(): Promise<{ otFlagged: number; absencesFlagged: number }> {
  return { otFlagged: flagPotentialOvertime(), absencesFlagged: markAbsentees() };
}
