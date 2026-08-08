import { NextRequest, NextResponse } from 'next/server';
import { getDb, runTransaction } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

function requireAdmin(session: Awaited<ReturnType<typeof getSession>>) {
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('payroll')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }
  return null;
}

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  const denied = requireAdmin(session);
  if (denied) return denied;

  const db = getDb();
  const period = db.prepare('SELECT * FROM payroll_periods WHERE id = ?').get(params.id);
  if (!period) return NextResponse.json({ error: 'Payroll period not found' }, { status: 404 });

  const entries = db.prepare('SELECT * FROM payroll_entries WHERE payroll_period_id = ? ORDER BY employee_name_snapshot ASC').all(params.id);

  return NextResponse.json({ period, entries });
}

// Sequential, guarded status transitions — matches the exact requested
// workflow: draft -> for_review -> approved -> paid -> locked. No skipping,
// no going backward. Once 'locked', this route (and every entry/adjustment
// mutation route) refuses further changes.
const NEXT_STATUS: Record<string, { action: string; next: string; actorField: string; atField: string }> = {
  draft: { action: 'review', next: 'for_review', actorField: 'reviewed_by', atField: 'reviewed_at' },
  for_review: { action: 'approve', next: 'approved', actorField: 'approved_by', atField: 'approved_at' },
  approved: { action: 'mark_paid', next: 'paid', actorField: 'paid_by', atField: 'paid_at' },
  paid: { action: 'lock', next: 'locked', actorField: 'locked_by', atField: 'locked_at' },
};

// Soft delete ("Void") — owner/'payroll'-permission only. Never a hard
// DELETE: the period, its entries, adjustments, and audit log rows are all
// kept intact, so the audit trail survives. A voided period just stops
// showing up in the default list (GET /api/payroll/periods filters
// voided_at IS NULL) and can no longer be opened/edited.
//
// Deliberately allowed even after payslips have been generated (an
// employee may already have seen theirs) — explicitly requested despite
// that risk. The confirm() dialog in PayrollClient is the only remaining
// safety net for that case, so its wording matters; don't weaken it.
export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  const denied = requireAdmin(session);
  if (denied) return denied;

  const db = getDb();
  const period = db.prepare('SELECT id, payslips_generated_at, voided_at FROM payroll_periods WHERE id = ?').get(params.id) as { id: number; payslips_generated_at: string | null; voided_at: string | null } | undefined;
  if (!period) return NextResponse.json({ error: 'Payroll period not found' }, { status: 404 });
  if (period.voided_at) return NextResponse.json({ error: 'This payroll period is already voided.' }, { status: 409 });

  runTransaction(() => {
    db.prepare(`UPDATE payroll_periods SET voided_at = datetime('now'), voided_by = ? WHERE id = ?`).run(session!.id, params.id);
    db.prepare(`
      INSERT INTO payroll_audit_log (payroll_period_id, actor_user_id, action, details) VALUES (?, ?, 'voided', 'Payroll period voided')
    `).run(params.id, session!.id);
  });

  return NextResponse.json({ ok: true });
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  const denied = requireAdmin(session);
  if (denied) return denied;

  try {
    const body = await req.json();
    const action: string = body.action;

    const db = getDb();
    const period = db.prepare('SELECT * FROM payroll_periods WHERE id = ?').get(params.id) as { id: number; status: string } | undefined;
    if (!period) return NextResponse.json({ error: 'Payroll period not found' }, { status: 404 });

    const transition = NEXT_STATUS[period.status];
    if (!transition || transition.action !== action) {
      return NextResponse.json({ error: `Cannot perform "${action}" from status "${period.status}".` }, { status: 409 });
    }

    runTransaction(() => {
      db.prepare(`
        UPDATE payroll_periods SET status = ?, ${transition.actorField} = ?, ${transition.atField} = datetime('now') WHERE id = ?
      `).run(transition.next, session!.id, params.id);

      db.prepare(`
        INSERT INTO payroll_audit_log (payroll_period_id, actor_user_id, action, details) VALUES (?, ?, ?, ?)
      `).run(params.id, session!.id, transition.next, `Status changed to ${transition.next}`);
    });

    return NextResponse.json({ ok: true, status: transition.next });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
