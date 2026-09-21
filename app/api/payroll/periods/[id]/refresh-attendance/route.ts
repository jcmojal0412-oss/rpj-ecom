import { NextRequest, NextResponse } from 'next/server';
import { getDb, runTransaction } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { refreshPayrollEntryFromAttendance } from '@/lib/payroll-data';

export const dynamic = 'force-dynamic';

interface EntrySnapshot {
  id: number; employee_name_snapshot: string; late_minutes: number; undertime_minutes: number;
  excess_break_minutes: number; absence_days: number; approved_ot_minutes: number; net_pay: number;
}

// Re-reads attendance (including corrections and OT decisions approved after
// this period was generated) into the period's entries. Only draft /
// for-review periods can be refreshed - once approved the numbers are frozen.
// Returns exactly what changed so HR can see the effect before moving on.
export async function POST(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('payroll')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  try {
    const db = getDb();
    const period = db.prepare('SELECT id, label, status, voided_at FROM payroll_periods WHERE id = ?').get(params.id) as
      { id: number; label: string; status: string; voided_at: string | null } | undefined;
    if (!period || period.voided_at) return NextResponse.json({ error: 'Payroll period not found' }, { status: 404 });
    if (period.status !== 'draft' && period.status !== 'for_review') {
      return NextResponse.json({ error: `This period is already ${period.status} - its attendance figures are frozen and can't be refreshed.` }, { status: 409 });
    }

    const read = () => db.prepare(`
      SELECT id, employee_name_snapshot, late_minutes, undertime_minutes, excess_break_minutes, absence_days, approved_ot_minutes, net_pay
      FROM payroll_entries WHERE payroll_period_id = ? ORDER BY employee_name_snapshot ASC
    `).all(period.id) as EntrySnapshot[];

    const before = new Map(read().map(e => [e.id, e]));
    let after: EntrySnapshot[] = [];
    runTransaction(() => {
      for (const id of before.keys()) refreshPayrollEntryFromAttendance(db, id);
      after = read();
    });

    const changed = after.filter(a => {
      const b = before.get(a.id)!;
      return b.late_minutes !== a.late_minutes || b.undertime_minutes !== a.undertime_minutes
        || b.excess_break_minutes !== a.excess_break_minutes || b.absence_days !== a.absence_days
        || b.approved_ot_minutes !== a.approved_ot_minutes || Math.abs(b.net_pay - a.net_pay) > 0.005;
    }).map(a => {
      const b = before.get(a.id)!;
      return {
        name: a.employee_name_snapshot,
        late: [b.late_minutes, a.late_minutes], undertime: [b.undertime_minutes, a.undertime_minutes],
        excess_break: [b.excess_break_minutes, a.excess_break_minutes], absence_days: [b.absence_days, a.absence_days],
        ot: [b.approved_ot_minutes, a.approved_ot_minutes], net_pay: [b.net_pay, a.net_pay],
      };
    });

    db.prepare(`
      INSERT INTO payroll_audit_log (payroll_period_id, actor_user_id, action, details) VALUES (?, ?, 'attendance_refreshed', ?)
    `).run(period.id, session.id, `Refreshed ${before.size} entr${before.size === 1 ? 'y' : 'ies'} from attendance; ${changed.length} changed`);

    return NextResponse.json({ ok: true, refreshed: before.size, changed });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
