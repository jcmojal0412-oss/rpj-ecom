import type Database from 'better-sqlite3';
import { computeDaySummary, type AttendanceEvent, type EventType } from './attendance';
import { resolveAttendanceSettings } from './attendance-shifts';
import { ensureOvertimeRequest } from './attendance-jobs';

// HR / owner manual editing of one employee's day: Time In, Time Out, lunch
// and coffee breaks. Nothing is ever overwritten or deleted - a changed punch
// is replaced by a new one and the old row is marked superseded, a removed
// punch is marked superseded by itself (every reader treats any non-null
// superseded_by as inactive), so the full history stays in the table and every
// edit is written to attendance_audit_log with before/after and the reason.

export interface PunchInput { id?: number; event_type: EventType; time: string } // time = PH "HH:MM"

const TYPES: EventType[] = ['TIME_IN', 'COFFEE_OUT', 'COFFEE_IN', 'LUNCH_OUT', 'LUNCH_IN', 'TIME_OUT'];
const SINGLE: EventType[] = ['TIME_IN', 'TIME_OUT', 'LUNCH_OUT', 'LUNCH_IN'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const phTimeToIso = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+08:00`).toISOString();
export const isoToPhHHMM = (iso: string) => new Date(new Date(iso).getTime() + 8 * 3600 * 1000).toISOString().slice(11, 16);

// Returns a human-readable problem with the set of punches, or null if they
// make sense as one working day.
export function validatePunches(punches: PunchInput[]): string | null {
  for (const p of punches) {
    if (!TYPES.includes(p.event_type)) return 'Unknown punch type.';
    if (!HHMM.test(String(p.time))) return 'Every punch needs a valid time.';
  }
  for (const t of SINGLE) {
    if (punches.filter(p => p.event_type === t).length > 1) return `Only one ${t.replace('_', ' ').toLowerCase()} is allowed per day.`;
  }
  const at = (t: EventType) => punches.find(p => p.event_type === t)?.time;
  const tin = at('TIME_IN'), tout = at('TIME_OUT');
  if (tout && !tin) return 'A Time Out needs a Time In.';
  if (tin && tout && tin >= tout) return 'Time Out must be after Time In.';
  for (const p of punches) {
    if (p.event_type === 'TIME_IN') continue;
    if (tin && p.time < tin) return 'Breaks and Time Out can\'t be earlier than Time In.';
    if (tout && p.event_type !== 'TIME_OUT' && p.time > tout) return 'Breaks can\'t be later than Time Out.';
  }
  const lo = at('LUNCH_OUT'), li = at('LUNCH_IN');
  if (li && !lo) return 'Lunch In needs a Lunch Out.';
  if (lo && li && li <= lo) return 'Lunch In must be after Lunch Out.';
  const coffee = punches.filter(p => p.event_type === 'COFFEE_OUT' || p.event_type === 'COFFEE_IN').sort((a, b) => a.time.localeCompare(b.time));
  let open = false;
  for (const c of coffee) {
    if (c.event_type === 'COFFEE_OUT') {
      if (open) return 'Two Coffee Outs in a row - each needs a Coffee In.';
      open = true;
    } else {
      if (!open) return 'A Coffee In needs a Coffee Out before it.';
      open = false;
    }
  }
  return null;
}

const fmt = (rows: { event_type: string; hhmm: string }[]) => rows.length ? rows.map(r => `${r.event_type} ${r.hhmm}`).join(', ') : 'none';

// After punches change, the day's overtime can change with them. Keeps the
// day's OT request in step: creates one if OT now exists, updates the excess,
// caps an approved amount that is no longer earned, and closes a request that
// no longer has any OT behind it. Returns notes for the audit log.
function reconcileOvertimeForDay(db: Database.Database, employeeId: number, date: string, actorId: number): string[] {
  const notes: string[] = [];
  const resolved = resolveAttendanceSettings(db, employeeId, date);
  const events = db.prepare(`
    SELECT id, event_type, event_time, superseded_by FROM attendance_events
    WHERE employee_id = ? AND event_date = ? AND is_test = 0 ORDER BY event_time ASC
  `).all(employeeId, date) as AttendanceEvent[];
  const potential = resolved ? computeDaySummary(events, resolved.settings, true).potentialOtMinutes : 0;

  const req = db.prepare('SELECT id, status, excess_minutes, approved_minutes FROM attendance_ot_requests WHERE employee_id = ? AND event_date = ?')
    .get(employeeId, date) as { id: number; status: string; excess_minutes: number; approved_minutes: number | null } | undefined;

  if (!req) {
    if (potential > 0 && ensureOvertimeRequest(employeeId, date)) notes.push(`OT request created (${potential} min, pending)`);
    return notes;
  }

  if (potential <= 0) {
    if (req.status !== 'rejected') {
      db.prepare(`
        UPDATE attendance_ot_requests SET status='rejected', approved_minutes=0, remarks=?, reviewed_by=?, reviewed_at=? WHERE id=?
      `).run('Auto-closed: no overtime after attendance was edited', actorId, new Date().toISOString(), req.id);
      notes.push(`OT ${req.status} -> rejected (no overtime after edit)`);
    }
  } else if (potential !== req.excess_minutes) {
    let approved = req.approved_minutes;
    let capped = false;
    if (req.status === 'approved' && approved !== null && approved > potential) { approved = potential; capped = true; }
    db.prepare('UPDATE attendance_ot_requests SET excess_minutes = ?, approved_minutes = ? WHERE id = ?').run(potential, approved, req.id);
    notes.push(`OT excess ${req.excess_minutes} -> ${potential} min${capped ? `, approved capped to ${approved}` : ''}`);
  }
  return notes;
}

export type ManualEditResult =
  | { ok: true; before: string; after: string; otNotes: string[] }
  | { ok: false; error: string; status: number };

export function applyManualAttendanceEdit(db: Database.Database, args: {
  employee: { id: number; linked_user_id: number | null };
  date: string; punches: PunchInput[]; reason: string; actorId: number;
}): ManualEditResult {
  const { employee, date, punches, reason, actorId } = args;

  const current = db.prepare(`
    SELECT id, event_type, event_time FROM attendance_events
    WHERE employee_id = ? AND event_date = ? AND superseded_by IS NULL AND is_test = 0 ORDER BY event_time ASC
  `).all(employee.id, date) as { id: number; event_type: EventType; event_time: string }[];
  const byId = new Map(current.map(e => [e.id, e]));

  for (const p of punches) {
    if (p.id != null && !byId.has(p.id)) return { ok: false, error: 'This day was changed by someone else while you were editing. Close and reopen it.', status: 409 };
  }
  const keptIds = new Set(punches.filter(p => p.id != null).map(p => p.id as number));
  const removed = current.filter(e => !keptIds.has(e.id));

  const insert = db.prepare(`
    INSERT INTO attendance_events (employee_id, user_id, event_date, event_type, event_time, source, created_by)
    VALUES (?, ?, ?, ?, ?, 'correction', ?)
  `);
  const legacyUserId = employee.linked_user_id ?? actorId; // legacy NOT NULL + FK column nothing reads

  let changes = 0;
  const beforeRows = current.map(e => ({ event_type: e.event_type, hhmm: isoToPhHHMM(e.event_time) }));
  const otNotes: string[] = [];

  db.transaction(() => {
    for (const p of punches) {
      const existing = p.id != null ? byId.get(p.id) : undefined;
      if (existing && existing.event_type === p.event_type && isoToPhHHMM(existing.event_time) === p.time) continue; // untouched
      const info = insert.run(employee.id, legacyUserId, date, p.event_type, phTimeToIso(date, p.time), actorId);
      if (existing) db.prepare('UPDATE attendance_events SET superseded_by = ? WHERE id = ?').run(Number(info.lastInsertRowid), existing.id);
      changes++;
    }
    for (const e of removed) {
      db.prepare('UPDATE attendance_events SET superseded_by = id WHERE id = ?').run(e.id);
      changes++;
    }
    if (changes === 0) return;

    const afterRows = db.prepare(`
      SELECT event_type, event_time FROM attendance_events
      WHERE employee_id = ? AND event_date = ? AND superseded_by IS NULL AND is_test = 0 ORDER BY event_time ASC
    `).all(employee.id, date) as { event_type: string; event_time: string }[];

    otNotes.push(...reconcileOvertimeForDay(db, employee.id, date, actorId));

    db.prepare(`
      INSERT INTO attendance_audit_log (actor_user_id, action, employee_id, event_date, details)
      VALUES (?, 'attendance_manual_edit', ?, ?, ?)
    `).run(actorId, employee.id, date,
      `reason: ${reason} | before: ${fmt(beforeRows)} | after: ${fmt(afterRows.map(r => ({ event_type: r.event_type, hhmm: isoToPhHHMM(r.event_time) })))}${otNotes.length ? ` | ${otNotes.join('; ')}` : ''}`);
  })();

  if (changes === 0) return { ok: false, error: 'No changes to save.', status: 400 };

  const after = db.prepare(`
    SELECT event_type, event_time FROM attendance_events
    WHERE employee_id = ? AND event_date = ? AND superseded_by IS NULL AND is_test = 0 ORDER BY event_time ASC
  `).all(employee.id, date) as { event_type: string; event_time: string }[];
  return { ok: true, before: fmt(beforeRows), after: fmt(after.map(r => ({ event_type: r.event_type, hhmm: isoToPhHHMM(r.event_time) }))), otNotes };
}
