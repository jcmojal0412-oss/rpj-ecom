import { NextRequest, NextResponse } from 'next/server';
import { getDb, runTransaction } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { createPayrollEntry, type EntryEmployee } from '@/lib/payroll-data';
import { payrollEditBlockedMessage } from '@/lib/payroll-lock';

export const dynamic = 'force-dynamic';

const MAX_AMOUNT = 10_000_000;

function requireAdmin(session: Awaited<ReturnType<typeof getSession>>) {
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('payroll')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }
  return null;
}

// Employees who could still be added to this payroll run (Active, not already in
// it), with a warning when they are already in another run covering the same dates.
export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  const denied = requireAdmin(session);
  if (denied) return denied;

  const db = getDb();
  const period = db.prepare('SELECT id, from_date, to_date, status, voided_at FROM payroll_periods WHERE id = ?').get(params.id) as { id: number; from_date: string; to_date: string; status: string; voided_at: string | null } | undefined;
  if (!period || period.voided_at) return NextResponse.json({ error: 'Payroll period not found' }, { status: 404 });

  const rows = db.prepare(`
    SELECT id, full_name, department, position, pay_basis, salary_type, basic_rate, payroll_schedule
    FROM employees
    WHERE employment_status = 'Active' AND id NOT IN (SELECT employee_id FROM payroll_entries WHERE payroll_period_id = ?)
    ORDER BY full_name ASC
  `).all(period.id) as { id: number; full_name: string; department: string | null; position: string | null; pay_basis: string; salary_type: string; basic_rate: number; payroll_schedule: string | null }[];
  const overlap = db.prepare(`
    SELECT p.label FROM payroll_entries e JOIN payroll_periods p ON p.id = e.payroll_period_id
    WHERE e.employee_id = ? AND p.voided_at IS NULL AND p.id != ? AND p.from_date <= ? AND p.to_date >= ? LIMIT 1
  `);
  return NextResponse.json({
    editable: !payrollEditBlockedMessage(period.status),
    available: rows.map(r => ({
      ...r,
      per_cutoff: r.pay_basis === 'fixed' ? Math.round((r.basic_rate / 2) * 100) / 100 : null,
      in_other_run: (overlap.get(r.id, period.id, period.to_date, period.from_date) as { label: string } | undefined)?.label ?? null,
    })),
  });
}

// "Add employee to this payroll run": one snapshotted entry, built by the same
// function payroll generation uses. Only while the run is still being prepared
// (Draft / For Approval); never twice for the same person and dates.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  const denied = requireAdmin(session);
  if (denied) return denied;

  try {
    const body = await req.json();
    const employeeId = Number(body.employee_id);
    if (!Number.isInteger(employeeId) || employeeId <= 0) return NextResponse.json({ error: 'Choose an employee.' }, { status: 400 });

    const db = getDb();
    const period = db.prepare('SELECT id, label, from_date, to_date, status, voided_at FROM payroll_periods WHERE id = ?').get(params.id) as { id: number; label: string; from_date: string; to_date: string; status: string; voided_at: string | null } | undefined;
    if (!period || period.voided_at) return NextResponse.json({ error: 'Payroll period not found' }, { status: 404 });
    const blocked = payrollEditBlockedMessage(period.status);
    if (blocked) return NextResponse.json({ error: blocked }, { status: 409 });

    const employee = db.prepare(`
      SELECT id, full_name, work_days, rest_day, salary_type, basic_rate, allowance, ot_eligible, position, pay_basis, employment_status,
             sss_enabled, philhealth_enabled, pagibig_enabled, sss_deduction_amount, philhealth_deduction_amount, pagibig_deduction_amount
      FROM employees WHERE id = ?
    `).get(employeeId) as (EntryEmployee & { employment_status: string }) | undefined;
    if (!employee) return NextResponse.json({ error: 'Employee not found.' }, { status: 404 });
    if (employee.employment_status !== 'Active') return NextResponse.json({ error: 'Only Active employees can be added to payroll.' }, { status: 400 });

    if (db.prepare('SELECT 1 FROM payroll_entries WHERE payroll_period_id = ? AND employee_id = ?').get(period.id, employeeId)) {
      return NextResponse.json({ error: `${employee.full_name} is already in this payroll run.` }, { status: 409 });
    }
    // Never pay the same person twice for the same dates.
    const other = db.prepare(`
      SELECT p.label FROM payroll_entries e JOIN payroll_periods p ON p.id = e.payroll_period_id
      WHERE e.employee_id = ? AND p.voided_at IS NULL AND p.id != ? AND p.from_date <= ? AND p.to_date >= ? LIMIT 1
    `).get(employeeId, period.id, period.to_date, period.from_date) as { label: string } | undefined;
    if (other) return NextResponse.json({ error: `${employee.full_name} is already in the payroll run "${other.label}", which covers some of the same dates.` }, { status: 409 });

    const fixed = employee.pay_basis === 'fixed';
    let amount: number | null = null;
    if (body.amount !== undefined && body.amount !== null && body.amount !== '') {
      if (!fixed) return NextResponse.json({ error: 'A custom amount can only be set for a fixed-rate employee. Others are paid from attendance.' }, { status: 400 });
      amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) return NextResponse.json({ error: 'Amount must be more than ₱0.' }, { status: 400 });
      amount = Math.round(amount * 100) / 100;
    }
    if (!employee.basic_rate && amount === null) {
      return NextResponse.json({ error: `${employee.full_name} has no salary / rate set. Set it on their profile first.` }, { status: 400 });
    }

    const otRow = db.prepare(`SELECT value FROM app_settings WHERE key = 'payroll_ot_multiplier'`).get() as { value: string } | undefined;
    const otMultiplier = otRow ? Number(otRow.value) : 1.25;

    let entryId = 0;
    runTransaction(() => {
      entryId = createPayrollEntry(db, { periodId: period.id, fromDate: period.from_date, toDate: period.to_date, employee, otMultiplier, basicPayOverride: amount });
      db.prepare(`INSERT INTO payroll_audit_log (payroll_period_id, payroll_entry_id, actor_user_id, action, details) VALUES (?, ?, ?, 'entry_added', ?)`)
        .run(period.id, entryId, session!.id, `${employee.full_name} added to this payroll run manually${fixed ? (amount !== null ? ` (fixed rate, ₱${amount.toFixed(2)} for this run)` : ' (fixed rate)') : ''}`);
    });
    return NextResponse.json({ ok: true, entry_id: entryId }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
