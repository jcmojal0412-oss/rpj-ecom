import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getActiveEmployeeForUser } from '@/lib/attendance-shifts';

export const dynamic = 'force-dynamic';

// Admin/owner sees every payslip across every period. A regular employee
// sees ONLY their own, and only once HR has clicked "Generate Payslips"
// for that period (payslips_generated_at set) — matches "Employee can only
// view their own payslip."
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const db = getDb();
  const isAdmin = session.role === 'owner' || session.permissions.includes('payroll');

  if (isAdmin) {
    const rows = db.prepare(`
      SELECT e.id, e.employee_name_snapshot, e.employee_code_snapshot, e.net_pay, e.gross_pay,
        p.id as period_id, p.label as period_label, p.from_date, p.to_date, p.status as period_status, p.payslips_generated_at
      FROM payroll_entries e JOIN payroll_periods p ON p.id = e.payroll_period_id
      ORDER BY p.from_date DESC, e.employee_name_snapshot ASC
    `).all();
    return NextResponse.json(rows);
  }

  const employee = getActiveEmployeeForUser(db, session.id);
  if (!employee) return NextResponse.json([]);

  const rows = db.prepare(`
    SELECT e.id, e.employee_name_snapshot, e.employee_code_snapshot, e.net_pay, e.gross_pay,
      p.id as period_id, p.label as period_label, p.from_date, p.to_date, p.status as period_status, p.payslips_generated_at
    FROM payroll_entries e JOIN payroll_periods p ON p.id = e.payroll_period_id
    WHERE e.employee_id = ? AND p.payslips_generated_at IS NOT NULL
    ORDER BY p.from_date DESC
  `).all(employee.id);
  return NextResponse.json(rows);
}
