import { NextRequest, NextResponse } from 'next/server';
import { getDb, runTransaction } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { refreshOpenPayrollForEmployeeDate } from '@/lib/payroll-data';

export const dynamic = 'force-dynamic';

// Approving a correction never mutates the original event row (if one
// exists) — it INSERTs a new event (source='correction') and marks the
// original superseded_by, preserving full history. When the request didn't
// name an original event (the admin File Correction form never does), the
// day's existing event of the same single-occurrence type is superseded, so
// the wrong punch can't keep winning; coffee breaks repeat during a day, so
// those are never auto-replaced. If a draft / for-review payroll period
// covers the date, the employee's entry is refreshed so the fix actually
// reaches their pay. This IS the audit trail
// for manual attendance changes, plus a row is written to
// attendance_audit_log for a durable, queryable "who approved what" record.
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('attendance')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const action: 'approve' | 'reject' = body.action;
    const remarks: string | null = body.remarks?.trim() || null;

    const db = getDb();
    const correction = db.prepare('SELECT * FROM attendance_corrections WHERE id = ?').get(params.id) as
      | { id: number; employee_id: number; event_date: string; original_event_id: number | null; requested_event_type: string; requested_time: string; status: string }
      | undefined;
    if (!correction) return NextResponse.json({ error: 'Correction request not found' }, { status: 404 });
    if (correction.status !== 'pending') return NextResponse.json({ error: 'This request was already reviewed' }, { status: 409 });

    const now = new Date().toISOString();

    if (action === 'reject') {
      runTransaction(() => {
        db.prepare(`
          UPDATE attendance_corrections SET status='rejected', remarks=?, reviewed_by=?, reviewed_at=? WHERE id=?
        `).run(remarks, session!.id, now, correction.id);
        db.prepare(`
          INSERT INTO attendance_audit_log (actor_user_id, action, employee_id, event_date, details)
          VALUES (?, 'correction_rejected', ?, ?, ?)
        `).run(session!.id, correction.employee_id, correction.event_date, remarks || '');
      });
      return NextResponse.json({ ok: true });
    }

    if (action === 'approve') {
      // The corrected time must fall on the day being corrected (PH time).
      // A mismatched date silently sorts the new punch AFTER the day's real
      // ones, so the wrong original kept being used and the "fix" did nothing.
      const phDate = new Date(new Date(correction.requested_time).getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
      if (phDate !== correction.event_date) {
        return NextResponse.json({
          error: `The corrected time falls on ${phDate}, but the correction is for ${correction.event_date}. Reject this request and file a new one with the time on ${correction.event_date}.`,
        }, { status: 400 });
      }

      const employee = db.prepare('SELECT linked_user_id FROM employees WHERE id = ?').get(correction.employee_id) as { linked_user_id: number | null } | undefined;
      // user_id is a legacy NOT NULL + FK(users.id) column nothing reads
      // anymore, but foreign_keys=ON means it must reference a REAL row —
      // the reviewing admin's own id always satisfies it when unlinked.
      const legacyUserId = employee?.linked_user_id ?? session!.id;
      let refreshedPeriods: string[] = [];

      runTransaction(() => {
        const info = db.prepare(`
          INSERT INTO attendance_events (employee_id, user_id, event_date, event_type, event_time, source, correction_id, created_by)
          VALUES (?, ?, ?, ?, ?, 'correction', ?, ?)
        `).run(correction.employee_id, legacyUserId, correction.event_date, correction.requested_event_type, correction.requested_time, correction.id, session!.id);
        const newEventId = Number(info.lastInsertRowid);

        if (correction.original_event_id) {
          db.prepare('UPDATE attendance_events SET superseded_by = ? WHERE id = ?').run(newEventId, correction.original_event_id);
        } else if (['TIME_IN', 'TIME_OUT', 'LUNCH_OUT', 'LUNCH_IN'].includes(correction.requested_event_type)) {
          db.prepare(`
            UPDATE attendance_events SET superseded_by = ?
            WHERE employee_id = ? AND event_date = ? AND event_type = ? AND superseded_by IS NULL AND is_test = 0 AND id != ?
          `).run(newEventId, correction.employee_id, correction.event_date, correction.requested_event_type, newEventId);
        }

        db.prepare(`
          UPDATE attendance_corrections SET status='approved', remarks=?, new_event_id=?, reviewed_by=?, reviewed_at=? WHERE id=?
        `).run(remarks, newEventId, session!.id, now, correction.id);

        db.prepare(`
          INSERT INTO attendance_audit_log (actor_user_id, action, employee_id, event_date, details)
          VALUES (?, 'correction_approved', ?, ?, ?)
        `).run(session!.id, correction.employee_id, correction.event_date,
          `${correction.requested_event_type} -> ${correction.requested_time}${remarks ? `, remarks: ${remarks}` : ''}`);

        refreshedPeriods = refreshOpenPayrollForEmployeeDate(db, correction.employee_id, correction.event_date);
      });
      return NextResponse.json({
        ok: true,
        payroll_note: refreshedPeriods.length ? `Payroll updated: ${refreshedPeriods.join(', ')}` : undefined,
      });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
