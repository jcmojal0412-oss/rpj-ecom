import { NextRequest, NextResponse } from 'next/server';
import { getDb, runTransaction } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { createPayrollEntry, type EntryEmployee } from '@/lib/payroll-data';

export const dynamic = 'force-dynamic';

function requireAdmin(session: Awaited<ReturnType<typeof getSession>>) {
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('payroll')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }
  return null;
}

export async function GET() {
  const session = await getSession();
  const denied = requireAdmin(session);
  if (denied) return denied;

  const db = getDb();
  const periods = db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM payroll_entries e WHERE e.payroll_period_id = p.id) as employee_count,
      (SELECT COALESCE(SUM(net_pay), 0) FROM payroll_entries e WHERE e.payroll_period_id = p.id) as total_net_pay
    FROM payroll_periods p WHERE p.voided_at IS NULL ORDER BY p.from_date DESC
  `).all();

  // Surfaced as a banner on the Payroll list — active/attendance-enabled
  // employees still missing a Schedule A/B assignment are silently excluded
  // from every payroll run (see POST below), so this needs to stay visible
  // until HR/owner assigns everyone, not just discovered by surprise later.
  const unassignedCount = (db.prepare(`
    SELECT COUNT(*) as c FROM employees WHERE employment_status = 'Active' AND (attendance_enabled = 1 OR pay_basis = 'fixed') AND payroll_schedule IS NULL
  `).get() as { c: number }).c;

  return NextResponse.json({ periods, unassigned_count: unassignedCount });
}

// STEP 1's "Generate Payroll" — creates the period + one snapshotted entry
// per Active + Attendance Enabled employee, computing everything right now
// via lib/payroll.ts. Nothing about this ever changes again once written,
// regardless of later edits to the employee's salary/shift/attendance —
// that's the entire point of the snapshot columns on payroll_entries.
export async function POST(req: NextRequest) {
  const session = await getSession();
  const denied = requireAdmin(session);
  if (denied) return denied;

  try {
    const body = await req.json();
    const { from_date, to_date, label, pay_date, schedule } = body;
    if (!from_date || !to_date || !label?.trim()) {
      return NextResponse.json({ error: 'from_date, to_date, and label are required' }, { status: 400 });
    }
    if (to_date < from_date) {
      return NextResponse.json({ error: 'To Date cannot be before From Date' }, { status: 400 });
    }
    if (schedule !== 'A' && schedule !== 'B') {
      return NextResponse.json({ error: 'schedule must be "A" or "B"' }, { status: 400 });
    }
    if (!pay_date) {
      return NextResponse.json({ error: 'pay_date is required' }, { status: 400 });
    }

    const db = getDb();
    // voided_at IS NULL — a voided period must never permanently block
    // regenerating that same cutoff (e.g. HR voided a mistake and wants to
    // redo it correctly). The GET list already excludes voided periods the
    // same way; this check needs to match or a void becomes a dead zone.
    const existing = db.prepare('SELECT id FROM payroll_periods WHERE from_date = ? AND to_date = ? AND schedule = ? AND voided_at IS NULL').get(from_date, to_date, schedule);
    if (existing) return NextResponse.json({ error: 'A payroll period already exists for this exact date range and schedule.' }, { status: 409 });

    const otMultiplierRow = db.prepare(`SELECT value FROM app_settings WHERE key = 'payroll_ot_multiplier'`).get() as { value: string } | undefined;
    const otMultiplier = otMultiplierRow ? Number(otMultiplierRow.value) : 1.25;

    // Only employees explicitly assigned to THIS schedule are pulled in — an
    // employee with no payroll_schedule set yet is silently excluded from
    // every payroll run until someone assigns them on their profile (owner's
    // explicit choice: no default/fallback schedule). See the warning banner
    // on the Payroll list, which surfaces how many employees are still unset.
    const employees = db.prepare(`
      SELECT id, full_name, work_days, rest_day, salary_type, basic_rate, allowance, ot_eligible, position, pay_basis,
        sss_enabled, philhealth_enabled, pagibig_enabled,
        sss_deduction_amount, philhealth_deduction_amount, pagibig_deduction_amount
      FROM employees WHERE employment_status = 'Active' AND (attendance_enabled = 1 OR pay_basis = 'fixed') AND payroll_schedule = ?
    `).all(schedule) as EntryEmployee[];

    let periodId = 0;
    runTransaction(() => {
      const periodInfo = db.prepare(`
        INSERT INTO payroll_periods (from_date, to_date, label, status, generated_by, schedule, pay_date) VALUES (?, ?, ?, 'draft', ?, ?, ?)
      `).run(from_date, to_date, label.trim(), session!.id, schedule, pay_date);
      periodId = Number(periodInfo.lastInsertRowid);

      for (const employee of employees) {
        createPayrollEntry(db, { periodId, fromDate: from_date, toDate: to_date, employee, otMultiplier });
      }

      db.prepare(`
        INSERT INTO payroll_audit_log (payroll_period_id, actor_user_id, action, details) VALUES (?, ?, 'generated', ?)
      `).run(periodId, session!.id, `Generated for ${employees.length} employee(s)`);
    });

    return NextResponse.json({ id: periodId }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
