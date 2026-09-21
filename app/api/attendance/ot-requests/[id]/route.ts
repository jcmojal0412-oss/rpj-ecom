import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getFinalizedPayrollPeriodFor, syncApprovedOtIntoOpenPayroll } from '@/lib/payroll-data';

export const dynamic = 'force-dynamic';

// Reviewing sets `approved_minutes` on this request row. `excess_minutes`
// (the raw computed overage) is never itself payable; only a reviewed
// request's `approved_minutes` (status='approved') is ever consumed by
// payroll, and nothing auto-converts a 'pending' request into anything
// payable.
//
// A request that was already reviewed can be changed again by sending
// `edit: true` (owner or anyone with the 'attendance' permission, i.e. HR).
// That is refused once a payroll period covering the date is approved /
// paid / locked, since those have frozen what was actually paid. For a
// draft / for-review period the employee's payroll entry is re-synced so the
// new decision is reflected instead of silently going stale.
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
    const isEdit = body.edit === true;

    const db = getDb();
    const request = db.prepare('SELECT * FROM attendance_ot_requests WHERE id = ?').get(params.id) as
      { id: number; employee_id: number; event_date: string; excess_minutes: number; status: string; approved_minutes: number | null } | undefined;
    if (!request) return NextResponse.json({ error: 'OT request not found' }, { status: 404 });
    if (request.status !== 'pending' && !isEdit) return NextResponse.json({ error: 'This request was already reviewed' }, { status: 409 });

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

    // Rejecting a still-pending request is always harmless (0 minutes, nothing
    // reaches payroll), so it stays allowed even inside a finalized period —
    // that's how stale pending requests get cleared. Anything that could
    // change paid/approved money is refused.
    const finalized = getFinalizedPayrollPeriodFor(db, request.event_date);
    if (finalized && !(request.status === 'pending' && action === 'reject')) {
      return NextResponse.json({
        error: `Payroll "${finalized.label}" is already ${finalized.status} — OT for ${request.event_date} can no longer be changed here. Add it as a payroll adjustment instead.`,
      }, { status: 409 });
    }

    const wasReviewed = request.status !== 'pending';
    if (wasReviewed) auditAction = 'ot_edited';

    const now = new Date().toISOString();
    let syncedPeriods: string[] = [];
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
        `${wasReviewed ? `was ${request.status}/${request.approved_minutes ?? 0}min -> ${status}/${approvedMinutes}min; ` : ''}excess=${request.excess_minutes}min, approved=${approvedMinutes}min${remarks ? `, remarks: ${remarks}` : ''}`);

      syncedPeriods = syncApprovedOtIntoOpenPayroll(db, request.employee_id, request.event_date);
    });
    tx();

    return NextResponse.json({
      ok: true,
      payroll_note: syncedPeriods.length ? `Payroll updated: ${syncedPeriods.join(', ')}` : undefined,
    });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
