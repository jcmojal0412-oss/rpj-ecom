import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { buildMonitor, employeeHistory, listPeriods } from '@/lib/payslip-monitor';

export const dynamic = 'force-dynamic';

// Read-only Payroll History — the one place to look up a past payroll run,
// or one employee's pay across every run they were ever part of, including
// runs that were later voided. Nothing here can change a figure: no
// approve/pay/send actions, unlike the Payroll / Payslips monitor this
// reuses its data layer from.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('payroll')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const db = getDb();
  const periodId = req.nextUrl.searchParams.get('period_id');
  const employeeId = req.nextUrl.searchParams.get('employee_id');

  if (periodId) {
    const id = Number(periodId);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Payroll period not found' }, { status: 404 });
    const data = buildMonitor(db, id, { includeVoided: true });
    if (!data) return NextResponse.json({ error: 'Payroll period not found' }, { status: 404 });
    return NextResponse.json({ data });
  }

  if (employeeId) {
    const id = Number(employeeId);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
    const emp = db.prepare('SELECT id, full_name FROM employees WHERE id = ?').get(id) as { id: number; full_name: string } | undefined;
    if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
    const entries = employeeHistory(db, id, { includeVoided: true });
    return NextResponse.json({ employee: emp, entries });
  }

  // No filter: the pickers for both tabs.
  const periods = listPeriods(db, { includeVoided: true });
  const employees = db.prepare(`
    SELECT DISTINCT e.employee_id AS id, e.employee_name_snapshot AS full_name
    FROM payroll_entries e ORDER BY e.employee_name_snapshot COLLATE NOCASE ASC
  `).all();
  return NextResponse.json({ periods, employees });
}
