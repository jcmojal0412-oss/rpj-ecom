import { NextRequest, NextResponse } from 'next/server';
import { getDb, runTransaction } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { netMismatch } from '@/lib/payslip-integrity';

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

  // Never hand employees a payslip whose totals disagree with each other.
  const pending = db.prepare(`SELECT employee_name_snapshot AS name, gross_pay, total_deductions, net_pay FROM payroll_entries WHERE payroll_period_id = ? AND payslip_released_at IS NULL`).all(params.id) as { name: string; gross_pay: number; total_deductions: number; net_pay: number }[];
  const broken = pending.filter(e => netMismatch(e));
  if (broken.length > 0) {
    return NextResponse.json({ error: `Payslips can't be generated: the totals don't add up for ${broken.map(b => b.name).join(', ')}. Correct the payroll first.` }, { status: 409 });
  }

  runTransaction(() => {
    db.prepare(`UPDATE payroll_periods SET payslips_generated_by = ?, payslips_generated_at = datetime('now') WHERE id = ?`).run(session!.id, params.id);
    // "Generate Payslips" releases every payslip in the period that hasn't
    // already been released one by one from the Payslips page.
    db.prepare(`
      UPDATE payroll_entries SET payslip_released_at = datetime('now'), payslip_released_by = ?
      WHERE payroll_period_id = ? AND payslip_released_at IS NULL
    `).run(session!.id, params.id);
    db.prepare(`INSERT INTO payroll_audit_log (payroll_period_id, actor_user_id, action, details) VALUES (?, ?, 'payslips_generated', 'Payslips made visible to employees')`).run(params.id, session!.id);
  });

  return NextResponse.json({ ok: true });
}
