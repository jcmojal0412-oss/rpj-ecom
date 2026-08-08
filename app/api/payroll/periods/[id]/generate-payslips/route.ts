import { NextRequest, NextResponse } from 'next/server';
import { getDb, runTransaction } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Not a status change — the period stays 'approved' until separately
// marked Paid. This just flips payslips_generated_at, which is what gates
// whether employees can see their own payslip yet (see /api/payslips).
export async function POST(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('payroll')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const db = getDb();
  const period = db.prepare('SELECT * FROM payroll_periods WHERE id = ?').get(params.id) as { id: number; status: string } | undefined;
  if (!period) return NextResponse.json({ error: 'Payroll period not found' }, { status: 404 });
  if (period.status !== 'approved' && period.status !== 'paid' && period.status !== 'locked') {
    return NextResponse.json({ error: 'Payroll must be approved before payslips can be generated.' }, { status: 409 });
  }

  runTransaction(() => {
    db.prepare(`UPDATE payroll_periods SET payslips_generated_by = ?, payslips_generated_at = datetime('now') WHERE id = ?`).run(session!.id, params.id);
    db.prepare(`INSERT INTO payroll_audit_log (payroll_period_id, actor_user_id, action, details) VALUES (?, ?, 'payslips_generated', 'Payslips made visible to employees')`).run(params.id, session!.id);
  });

  return NextResponse.json({ ok: true });
}
