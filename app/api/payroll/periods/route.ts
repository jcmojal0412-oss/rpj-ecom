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
    FROM payroll_periods p ORDER BY p.from_date DESC
  `).all();
  return NextResponse.json(periods);
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
    const { from_date, to_date, label } = body;
    if (!from_date || !to_date || !label?.trim()) {
      return NextResponse.json({ error: 'from_date, to_date, and label are required' }, { status: 400 });
    }
    if (to_date < from_date) {
      return NextResponse.json({ error: 'To Date cannot be before From Date' }, { status: 400 });
    }

    const db = getDb();
    const existing = db.prepare('SELECT id FROM payroll_periods WHERE from_date = ? AND to_date = ?').get(from_date, to_date);
    if (existing) return NextResponse.json({ error: 'A payroll period already exists for this exact date range.' }, { status: 409 });

    const otMultiplierRow = db.prepare(`SELECT value FROM app_settings WHERE key = 'payroll_ot_multiplier'`).get() as { value: string } | undefined;
    const otMultiplier = otMultiplierRow ? Number(otMultiplierRow.value) : 1.25;

    const employees = db.prepare(`
      SELECT id, full_name, work_days, rest_day, salary_type, basic_rate, allowance, ot_eligible, position
      FROM employees WHERE employment_status = 'Active' AND attendance_enabled = 1
    `).all() as (PayrollEmployee & { position: string | null })[];

    let periodId = 0;
    runTransaction(() => {
      const periodInfo = db.prepare(`
        INSERT INTO payroll_periods (from_date, to_date, label, status, generated_by) VALUES (?, ?, ?, 'draft', ?)
      `).run(from_date, to_date, label.trim(), session!.id);
      periodId = Number(periodInfo.lastInsertRowid);

      for (const employee of employees) {
        const attendance = aggregateAttendanceForPeriod(db, employee, from_date, to_date);
        const approvedOtMinutes = employee.ot_eligible ? getApprovedOtMinutes(db, employee.id, from_date, to_date) : 0;

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
            other_deductions, total_deductions, net_pay
          ) VALUES (?,?,?,?,?, ?,?,?, ?,?,?,?,?,?, ?,?, ?,?,?,?,?, ?,?,?,?,?, ?,?,?)
        `).run(
          periodId, employee.id, employee.full_name, employeeCode(employee.id), employee.position,
          employee.salary_type, employee.basic_rate, employee.allowance,
          attendance.workDaysInPeriod, attendance.lateMinutes, attendance.undertimeMinutes, attendance.excessBreakMinutes, attendance.absenceDays, attendance.unpaidLeaveDays,
          approvedOtMinutes, otMultiplier,
          breakdown.basicPay, breakdown.otPay, breakdown.allowancePay, breakdown.bonusEarnings, breakdown.grossPay,
          breakdown.lateDeduction, breakdown.undertimeDeduction, breakdown.excessBreakDeduction, breakdown.absenceDeduction, breakdown.unpaidLeaveDeduction,
          breakdown.otherDeductions, breakdown.totalDeductions, breakdown.netPay
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
