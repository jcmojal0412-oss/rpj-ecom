import { NextRequest, NextResponse } from 'next/server';
import { getDb, runTransaction } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Approving a correction never mutates the original event row (if one
// exists) — it INSERTs a new event (source='correction') and marks the
// original superseded_by, preserving full history. This IS the audit trail
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
      const employee = db.prepare('SELECT linked_user_id FROM employees WHERE id = ?').get(correction.employee_id) as { linked_user_id: number | null } | undefined;
      // user_id is a legacy NOT NULL column nothing reads anymore — falls
      // back to a per-employee-unique negative sentinel when there's no
      // linked user (see lib/attendance-jobs.ts for the same pattern).
      const legacyUserId = employee?.linked_user_id ?? -correction.employee_id;

      runTransaction(() => {
        const info = db.prepare(`
          INSERT INTO attendance_events (employee_id, user_id, event_date, event_type, event_time, source, correction_id, created_by)
          VALUES (?, ?, ?, ?, ?, 'correction', ?, ?)
        `).run(correction.employee_id, legacyUserId, correction.event_date, correction.requested_event_type, correction.requested_time, correction.id, session!.id);
        const newEventId = Number(info.lastInsertRowid);

        if (correction.original_event_id) {
          db.prepare('UPDATE attendance_events SET superseded_by = ? WHERE id = ?').run(newEventId, correction.original_event_id);
        }

        db.prepare(`
          UPDATE attendance_corrections SET status='approved', remarks=?, new_event_id=?, reviewed_by=?, reviewed_at=? WHERE id=?
        `).run(remarks, newEventId, session!.id, now, correction.id);

        db.prepare(`
          INSERT INTO attendance_audit_log (actor_user_id, action, employee_id, event_date, details)
          VALUES (?, 'correction_approved', ?, ?, ?)
        `).run(session!.id, correction.employee_id, correction.event_date,
          `${correction.requested_event_type} -> ${correction.requested_time}${remarks ? `, remarks: ${remarks}` : ''}`);
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
