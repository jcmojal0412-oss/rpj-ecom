import { NextRequest, NextResponse } from 'next/server';
import { getDb, runTransaction } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { recomputePayrollEntry } from '@/lib/payroll-data';

export const dynamic = 'force-dynamic';

export async function DELETE(_: NextRequest, { params }: { params: { id: string; adjId: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('payroll')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const db = getDb();
  const entry = db.prepare(`
    SELECT e.id, e.payroll_period_id, p.status FROM payroll_entries e
    JOIN payroll_periods p ON p.id = e.payroll_period_id WHERE e.id = ?
  `).get(params.id) as { id: number; payroll_period_id: number; status: string } | undefined;
  if (!entry) return NextResponse.json({ error: 'Payroll entry not found' }, { status: 404 });
  if (entry.status === 'locked') return NextResponse.json({ error: 'This payroll period is locked and can no longer be edited.' }, { status: 409 });

  const adjustment = db.prepare('SELECT * FROM payroll_adjustments WHERE id = ? AND payroll_entry_id = ?').get(params.adjId, params.id) as { adjustment_type: string; amount: number; reason: string } | undefined;
  if (!adjustment) return NextResponse.json({ error: 'Adjustment not found' }, { status: 404 });

  runTransaction(() => {
    db.prepare('DELETE FROM payroll_adjustments WHERE id = ?').run(params.adjId);
    recomputePayrollEntry(db, entry.id);
    db.prepare(`
      INSERT INTO payroll_audit_log (payroll_period_id, payroll_entry_id, actor_user_id, action, details)
      VALUES (?, ?, ?, 'adjustment_removed', ?)
    `).run(entry.payroll_period_id, entry.id, session!.id, `${adjustment.adjustment_type}: ₱${adjustment.amount} — ${adjustment.reason} (removed)`);
  });

  return NextResponse.json({ ok: true });
}
