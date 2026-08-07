import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Approving/partial-approving here only ever sets `approved_minutes` on this
// request row — it does NOT create or touch any payroll record (there is no
// payroll module yet). `excess_minutes` (the raw computed overage) is never
// itself payable; only a reviewed request's `approved_minutes` may ever be
// consumed by a future payroll module, and only once status='approved'.
// Nothing in this codebase auto-converts a 'pending' request into anything
// payable.
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('attendance')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const action: 'approve' | 'partial_approve' | 'reject' = body.action;
    const remarks: string | null = body.remarks?.trim() || null;

    const db = getDb();
    const request = db.prepare('SELECT * FROM attendance_ot_requests WHERE id = ?').get(params.id) as
      { id: number; employee_id: number; event_date: string; excess_minutes: number; status: string } | undefined;
    if (!request) return NextResponse.json({ error: 'OT request not found' }, { status: 404 });
    if (request.status !== 'pending') return NextResponse.json({ error: 'This request was already reviewed' }, { status: 409 });

    let approvedMinutes: number;
    let status: 'approved' | 'rejected';
    let auditAction: string;

    if (action === 'approve') {
      approvedMinutes = request.excess_minutes;
      status = 'approved';
      auditAction = 'ot_approved';
    } else if (action === 'partial_approve') {
      approvedMinutes = Number(body.approved_minutes);
      if (!Number.isFinite(approvedMinutes) || approvedMinutes < 0 || approvedMinutes > request.excess_minutes) {
        return NextResponse.json({ error: `approved_minutes must be between 0 and ${request.excess_minutes}` }, { status: 400 });
      }
      status = 'approved';
      auditAction = 'ot_partial_approved';
    } else if (action === 'reject') {
      approvedMinutes = 0;
      status = 'rejected';
      auditAction = 'ot_rejected';
    } else {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      db.prepare(`
        UPDATE attendance_ot_requests
        SET status=?, approved_minutes=?, remarks=?, reviewed_by=?, reviewed_at=?
        WHERE id=?
      `).run(status, approvedMinutes, remarks, session!.id, now, request.id);

      db.prepare(`
        INSERT INTO attendance_audit_log (actor_user_id, action, employee_id, event_date, details)
        VALUES (?, ?, ?, ?, ?)
      `).run(session!.id, auditAction, request.employee_id, request.event_date,
        `excess=${request.excess_minutes}min, approved=${approvedMinutes}min${remarks ? `, remarks: ${remarks}` : ''}`);
    });
    tx();

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
