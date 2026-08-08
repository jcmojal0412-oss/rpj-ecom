import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Employee 201 File "Payroll History" tab — every payroll_entries snapshot
// for one employee across all periods. Reads only existing frozen columns
// (same ones the Payroll module's own screens already read), so a period's
// history here is guaranteed to match what Payroll itself shows.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('payroll')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const employeeId = req.nextUrl.searchParams.get('employee_id');
  if (!employeeId) return NextResponse.json({ error: 'employee_id is required' }, { status: 400 });

  const db = getDb();
  const rows = db.prepare(`
    SELECT e.id, e.basic_pay, e.ot_pay, e.allowance_pay, e.bonus_earnings, e.gross_pay,
      e.total_deductions, e.net_pay,
      p.id as period_id, p.label as period_label, p.from_date, p.to_date, p.status as period_status
    FROM payroll_entries e JOIN payroll_periods p ON p.id = e.payroll_period_id
    WHERE e.employee_id = ? AND p.voided_at IS NULL ORDER BY p.from_date DESC
  `).all(employeeId);

  return NextResponse.json(rows);
}
