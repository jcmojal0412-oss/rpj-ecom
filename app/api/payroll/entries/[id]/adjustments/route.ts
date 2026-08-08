import { NextRequest, NextResponse } from 'next/server';
import { getDb, runTransaction } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { recomputePayrollEntry } from '@/lib/payroll-data';
import type { AdjustmentType } from '@/lib/payroll';

export const dynamic = 'force-dynamic';

const VALID_TYPES: AdjustmentType[] = ['bonus', 'incentive', 'additional_allowance', 'other_earning', 'cash_advance', 'loan_deduction', 'other_deduction'];

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
  const adjustments = db.prepare(`
    SELECT a.*, u.name as added_by_name FROM payroll_adjustments a
    LEFT JOIN users u ON u.id = a.added_by
    WHERE a.payroll_entry_id = ? ORDER BY a.created_at ASC
  `).all(params.id);
  return NextResponse.json(adjustments);
}

// Bonus/Incentive/Additional Allowance/Other Earning/Cash Advance/Loan
// Deduction/Other Deduction — always requires amount + reason, always
// records who added it and when (added_by + created_at), always written to
// payroll_audit_log. Blocked once the period is locked.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  const denied = requireAdmin(session);
  if (denied) return denied;

  try {
    const body = await req.json();
    const { adjustment_type, amount, reason } = body;

    if (!VALID_TYPES.includes(adjustment_type)) {
      return NextResponse.json({ error: 'Invalid adjustment_type' }, { status: 400 });
    }
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return NextResponse.json({ error: 'Amount must be a positive number' }, { status: 400 });
    }
    if (!reason?.trim()) {
      return NextResponse.json({ error: 'Reason is required' }, { status: 400 });
    }

    const db = getDb();
    const entry = db.prepare(`
      SELECT e.id, e.payroll_period_id, p.status FROM payroll_entries e
      JOIN payroll_periods p ON p.id = e.payroll_period_id WHERE e.id = ?
    `).get(params.id) as { id: number; payroll_period_id: number; status: string } | undefined;
    if (!entry) return NextResponse.json({ error: 'Payroll entry not found' }, { status: 404 });
    if (entry.status === 'locked') return NextResponse.json({ error: 'This payroll period is locked and can no longer be edited.' }, { status: 409 });

    let adjustmentId = 0;
    runTransaction(() => {
      const info = db.prepare(`
        INSERT INTO payroll_adjustments (payroll_entry_id, adjustment_type, amount, reason, added_by) VALUES (?, ?, ?, ?, ?)
      `).run(entry.id, adjustment_type, numericAmount, reason.trim(), session!.id);
      adjustmentId = Number(info.lastInsertRowid);

      recomputePayrollEntry(db, entry.id);

      db.prepare(`
        INSERT INTO payroll_audit_log (payroll_period_id, payroll_entry_id, actor_user_id, action, details)
        VALUES (?, ?, ?, 'adjustment_added', ?)
      `).run(entry.payroll_period_id, entry.id, session!.id, `${adjustment_type}: ₱${numericAmount} — ${reason.trim()}`);
    });

    return NextResponse.json({ id: adjustmentId }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
