import { NextRequest, NextResponse } from 'next/server';
import { getDb, runTransaction } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { computePayroll, type PayrollInput } from '@/lib/payroll';
import { aggregateAttendanceForPeriod, getApprovedOtMinutes, type PayrollEmployee } from '@/lib/payroll-data';

export const dynamic = 'force-dynamic';

function requireAdmin(session: Awaited<ReturnType<typeof getSession>>) {
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('payroll')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }
  return null;
}

function employeeCode(id: number) {
  return `RPJ-${String(id).padStart(4, '0')}`;
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
    SELECT COUNT(*) as c FROM employees WHERE employment_status = 'Active' AND attendance_enabled = 1 AND payroll_schedule IS NULL
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
    const existing = db.prepare('SELECT id FROM payroll_periods WHERE from_date = ? AND to_date = ? AND schedule = ?').get(from_date, to_date, schedule);
    if (existing) return NextResponse.json({ error: 'A payroll period already exists for this exact date range and schedule.' }, { status: 409 });

    const otMultiplierRow = db.prepare(`SELECT value FROM app_settings WHERE key = 'payroll_ot_multiplier'`).get() as { value: string } | undefined;
    const otMultiplier = otMultiplierRow ? Number(otMultiplierRow.value) : 1.25;

    // Only employees explicitly assigned to THIS schedule are pulled in — an
    // employee with no payroll_schedule set yet is silently excluded from
    // every payroll run until someone assigns them on their profile (owner's
    // explicit choice: no default/fallback schedule). See the warning banner
    // on the Payroll list, which surfaces how many employees are still unset.
    const employees = db.prepare(`
      SELECT id, full_name, work_days, rest_day, salary_type, basic_rate, allowance, ot_eligible, position,
        sss_enabled, philhealth_enabled, pagibig_enabled,
        sss_deduction_amount, philhealth_deduction_amount, pagibig_deduction_amount
      FROM employees WHERE employment_status = 'Active' AND attendance_enabled = 1 AND payroll_schedule = ?
    `).all(schedule) as (PayrollEmployee & { position: string | null; sss_deduction_amount: number; philhealth_deduction_amount: number; pagibig_deduction_amount: number })[];

    let periodId = 0;
    runTransaction(() => {
      const periodInfo = db.prepare(`
        INSERT INTO payroll_periods (from_date, to_date, label, status, generated_by, schedule, pay_date) VALUES (?, ?, ?, 'draft', ?, ?, ?)
      `).run(from_date, to_date, label.trim(), session!.id, schedule, pay_date);
      periodId = Number(periodInfo.lastInsertRowid);

      for (const employee of employees) {
        const attendance = aggregateAttendanceForPeriod(db, employee, from_date, to_date);
        const approvedOtMinutes = employee.ot_eligible ? getApprovedOtMinutes(db, employee.id, from_date, to_date) : 0;

        // Statutory Contributions are MANUAL per payroll run (not
        // auto-computed) — but each entry starts PRE-FILLED with the
        // employee's own default deduction amount (set on their 201 profile,
        // Statutory Contributions section) instead of ₱0, so HR isn't
        // retyping the same figure every cutoff. Still fully editable in
        // Review Payroll (PUT /api/payroll/entries/[id]/contributions).
        // Employer-share defaults aren't a thing yet (not asked for) — those
        // always start at ₱0. Disabled programs (*_enabled = 0) always start
        // at ₱0 regardless of any default on file. The bracket/percentage
        // engine in lib/statutory-contributions.ts and lib/payroll-data.ts's
        // computeStatutoryContributionsForPeriod() still exist, unused, in
        // case auto-compute is turned back on later.
        const input: PayrollInput = {
          salaryType: employee.salary_type,
          basicRate: employee.basic_rate,
          allowance: employee.allowance,
          workDaysInPeriod: attendance.workDaysInPeriod,
          lateMinutes: attendance.lateMinutes,
          undertimeMinutes: attendance.undertimeMinutes,
          excessBreakMinutes: attendance.excessBreakMinutes,
          absenceDays: attendance.absenceDays,
          unpaidLeaveDays: attendance.unpaidLeaveDays,
          approvedOtMinutes,
          otMultiplier,
          adjustments: [],
          sssEmployeeContribution: employee.sss_enabled ? (employee.sss_deduction_amount || 0) : 0,
          sssEmployerContribution: 0,
          sssEcContribution: 0,
          philhealthEmployeeContribution: employee.philhealth_enabled ? (employee.philhealth_deduction_amount || 0) : 0,
          philhealthEmployerContribution: 0,
          pagibigEmployeeContribution: employee.pagibig_enabled ? (employee.pagibig_deduction_amount || 0) : 0,
          pagibigEmployerContribution: 0,
        };
        const breakdown = computePayroll(input);

        db.prepare(`
          INSERT INTO payroll_entries (
            payroll_period_id, employee_id, employee_name_snapshot, employee_code_snapshot, position_snapshot,
            salary_type_snapshot, basic_rate_snapshot, allowance_snapshot,
            work_days_count, late_minutes, undertime_minutes, excess_break_minutes, absence_days, unpaid_leave_days,
            approved_ot_minutes, ot_multiplier_snapshot,
            basic_pay, ot_pay, allowance_pay, bonus_earnings, gross_pay,
            late_deduction, undertime_deduction, excess_break_deduction, absence_deduction, unpaid_leave_deduction,
            other_deductions, total_deductions, net_pay,
            contribution_basis_snapshot,
            sss_ee_contribution, sss_er_contribution, sss_ec_contribution, sss_version_snapshot,
            philhealth_ee_contribution, philhealth_er_contribution, philhealth_version_snapshot,
            pagibig_ee_contribution, pagibig_er_contribution, pagibig_version_snapshot
          ) VALUES (?,?,?,?,?, ?,?,?, ?,?,?,?,?,?, ?,?, ?,?,?,?,?, ?,?,?,?,?, ?,?,?, ?, ?,?,?,?, ?,?,?, ?,?,?)
        `).run(
          periodId, employee.id, employee.full_name, employeeCode(employee.id), employee.position,
          employee.salary_type, employee.basic_rate, employee.allowance,
          attendance.workDaysInPeriod, attendance.lateMinutes, attendance.undertimeMinutes, attendance.excessBreakMinutes, attendance.absenceDays, attendance.unpaidLeaveDays,
          approvedOtMinutes, otMultiplier,
          breakdown.basicPay, breakdown.otPay, breakdown.allowancePay, breakdown.bonusEarnings, breakdown.grossPay,
          breakdown.lateDeduction, breakdown.undertimeDeduction, breakdown.excessBreakDeduction, breakdown.absenceDeduction, breakdown.unpaidLeaveDeduction,
          breakdown.otherDeductions, breakdown.totalDeductions, breakdown.netPay,
          0,
          breakdown.sssEmployeeContribution, breakdown.sssEmployerContribution, breakdown.sssEcContribution, null,
          breakdown.philhealthEmployeeContribution, breakdown.philhealthEmployerContribution, null,
          breakdown.pagibigEmployeeContribution, breakdown.pagibigEmployerContribution, null
        );
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
