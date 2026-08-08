import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getActiveEmployeeForUser } from '@/lib/attendance-shifts';

export const dynamic = 'force-dynamic';

// Full printable payslip data for one entry. Reads only the immutable
// snapshot columns — never a live join to employees/attendance — so a
// payslip looks exactly the same today as it will in five years, no
// matter what changes on the employee's live record afterward.
export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const db = getDb();
  const entry = db.prepare(`
    SELECT e.*, p.label as period_label, p.from_date, p.to_date, p.status as period_status, p.payslips_generated_at, p.voided_at
    FROM payroll_entries e JOIN payroll_periods p ON p.id = e.payroll_period_id
    WHERE e.id = ?
  `).get(params.id) as any;
  // A voided period is hidden from every viewer, admin included — matches
  // the Void confirmation's promise that it disappears from view, not just
  // from the admin period list. Recovery is a direct-DB action only.
  if (!entry || entry.voided_at) return NextResponse.json({ error: 'Payslip not found' }, { status: 404 });

  const isAdmin = session.role === 'owner' || session.permissions.includes('payroll');
  if (!isAdmin) {
    const employee = getActiveEmployeeForUser(db, session.id);
    if (!employee || employee.id !== entry.employee_id || !entry.payslips_generated_at) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
  }

  const adjustments = db.prepare('SELECT adjustment_type, amount, reason FROM payroll_adjustments WHERE payroll_entry_id = ? ORDER BY created_at ASC').all(params.id);

  return NextResponse.json({ entry, adjustments });
}
