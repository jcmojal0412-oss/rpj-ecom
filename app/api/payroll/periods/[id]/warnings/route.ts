import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { checkAttendanceWarnings, type PayrollEmployee } from '@/lib/payroll-data';

export const dynamic = 'force-dynamic';

// Live re-check, not part of the frozen snapshot — pending items are
// dynamic (HR might approve an OT request in between visits), so this
// always reflects current reality rather than what was true at generation
// time. Purely informational: does not block moving forward in the wizard.
export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('payroll')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const db = getDb();
  const period = db.prepare('SELECT * FROM payroll_periods WHERE id = ?').get(params.id) as { from_date: string; to_date: string } | undefined;
  if (!period) return NextResponse.json({ error: 'Payroll period not found' }, { status: 404 });

  const employeeIds = (db.prepare('SELECT employee_id FROM payroll_entries WHERE payroll_period_id = ?').all(params.id) as { employee_id: number }[]).map(r => r.employee_id);
  const warnings = [];
  for (const employeeId of employeeIds) {
    const employee = db.prepare(`
      SELECT id, full_name, work_days, rest_day, salary_type, basic_rate, allowance, ot_eligible FROM employees WHERE id = ?
    `).get(employeeId) as PayrollEmployee | undefined;
    if (!employee) continue;
    warnings.push(...checkAttendanceWarnings(db, employee, period.from_date, period.to_date));
  }

  return NextResponse.json({ warnings, ready: warnings.length === 0 });
}
