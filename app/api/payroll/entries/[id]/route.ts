import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Full breakdown for the "click an employee" drill-down in Step 3 — reads
// ONLY the frozen snapshot columns on payroll_entries, never a live join
// back to employees/attendance_events, so this always reflects what was
// true at generation time even if the employee's salary/shift/attendance
// changes afterward.
export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('payroll')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const db = getDb();
  const entry = db.prepare(`
    SELECT e.*, p.status as period_status, p.label as period_label, p.from_date, p.to_date
    FROM payroll_entries e JOIN payroll_periods p ON p.id = e.payroll_period_id
    WHERE e.id = ?
  `).get(params.id);
  if (!entry) return NextResponse.json({ error: 'Payroll entry not found' }, { status: 404 });

  const adjustments = db.prepare(`
    SELECT a.*, u.name as added_by_name FROM payroll_adjustments a
    LEFT JOIN users u ON u.id = a.added_by
    WHERE a.payroll_entry_id = ? ORDER BY a.created_at ASC
  `).all(params.id);

  return NextResponse.json({ entry, adjustments });
}
