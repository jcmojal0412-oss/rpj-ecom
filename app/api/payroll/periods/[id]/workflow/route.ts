import { NextRequest, NextResponse } from 'next/server';
import { getDb, runTransaction } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// The two "step backwards" moves the normal Draft -> ... -> Locked flow
// (PUT /api/payroll/periods/[id]) deliberately doesn't have:
//   return — a period waiting for approval goes back to Draft for correction.
//            Anyone who can approve (owner / Payroll permission) may do it.
//   reopen — an APPROVED period goes back to Draft so its amounts can be edited
//            again. Owner only, and only while nothing depends on the approved
//            figures: no payment recorded and no payslip released. Paid /
//            locked periods can never be reopened.
// Both need a written reason, kept in the audit log and shown to HR.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('payroll')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  try {
    const { action, reason } = await req.json();
    const why = String(reason ?? '').trim();
    if (action !== 'return' && action !== 'reopen') return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    if (why.length < 3) return NextResponse.json({ error: 'Please write a reason.' }, { status: 400 });
    if (action === 'reopen' && session.role !== 'owner') {
      return NextResponse.json({ error: 'Only the owner can reopen an approved payroll.' }, { status: 403 });
    }

    const db = getDb();
    const period = db.prepare('SELECT id, label, status, voided_at FROM payroll_periods WHERE id = ?').get(params.id) as
      { id: number; label: string; status: string; voided_at: string | null } | undefined;
    if (!period || period.voided_at) return NextResponse.json({ error: 'Payroll period not found' }, { status: 404 });

    if (action === 'return') {
      if (period.status !== 'for_review') return NextResponse.json({ error: 'Only a payroll that is waiting for approval can be returned to HR.' }, { status: 409 });
    } else {
      if (period.status !== 'approved') {
        return NextResponse.json({ error: period.status === 'paid' || period.status === 'locked' ? 'A paid or locked payroll cannot be reopened.' : 'Only an approved payroll can be reopened.' }, { status: 409 });
      }
      const dep = db.prepare(`
        SELECT SUM(CASE WHEN payment_status IS NOT NULL THEN 1 ELSE 0 END) paid, SUM(CASE WHEN payslip_released_at IS NOT NULL THEN 1 ELSE 0 END) released
        FROM payroll_entries WHERE payroll_period_id = ?
      `).get(period.id) as { paid: number | null; released: number | null };
      if ((dep.paid ?? 0) > 0) return NextResponse.json({ error: 'Payments were already recorded for this payroll, so it cannot be reopened.' }, { status: 409 });
      if ((dep.released ?? 0) > 0) return NextResponse.json({ error: 'Payslips were already released to employees, so this payroll cannot be reopened.' }, { status: 409 });
    }

    runTransaction(() => {
      db.prepare(`
        UPDATE payroll_periods SET status = 'draft', reviewed_by = NULL, reviewed_at = NULL, approved_by = NULL, approved_at = NULL,
          return_kind = ?, return_reason = ?, returned_by = ?, returned_at = datetime('now')
        WHERE id = ?
      `).run(action === 'return' ? 'returned' : 'reopened', why, session.id, period.id);
      db.prepare(`INSERT INTO payroll_audit_log (payroll_period_id, actor_user_id, action, details) VALUES (?, ?, ?, ?)`)
        .run(period.id, session.id, action === 'return' ? 'returned' : 'reopened', `${action === 'return' ? 'Returned to HR' : 'Reopened for editing'}: ${why}`);
    });

    return NextResponse.json({ ok: true, status: 'draft' });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
