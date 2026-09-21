import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getPayslipEmployeeForUser } from '@/lib/attendance-shifts';

export const dynamic = 'force-dynamic';

// Records that a payslip was printed / downloaded. Only someone who is
// allowed to open that payslip can record it: Payroll admins for any, an
// employee for their own released one. "Viewed" is recorded by the payslip
// detail route itself when the employee opens it.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  try {
    const { event } = await req.json();
    const column = event === 'printed' ? 'payslip_printed_at' : event === 'downloaded' ? 'payslip_downloaded_at' : null;
    if (!column) return NextResponse.json({ error: 'Unknown event' }, { status: 400 });

    const db = getDb();
    const entry = db.prepare(`
      SELECT e.id, e.employee_id, e.payslip_released_at, p.voided_at
      FROM payroll_entries e JOIN payroll_periods p ON p.id = e.payroll_period_id WHERE e.id = ?
    `).get(params.id) as { id: number; employee_id: number; payslip_released_at: string | null; voided_at: string | null } | undefined;
    if (!entry || entry.voided_at) return NextResponse.json({ error: 'Payslip not found' }, { status: 404 });

    const isAdmin = session.role === 'owner' || session.permissions.includes('payroll');
    if (!isAdmin) {
      const employee = getPayslipEmployeeForUser(db, session.id);
      if (!employee || employee.id !== entry.employee_id || !entry.payslip_released_at) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
    }

    db.prepare(`UPDATE payroll_entries SET ${column} = datetime('now') WHERE id = ?`).run(entry.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
