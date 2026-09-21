import type Database from 'better-sqlite3';
import { checkAttendanceWarnings, type PayrollEmployee } from './payroll-data';
import { isValidEmail } from './payslip-email';

// Everything the Payslips & Payroll Monitoring page shows is READ from the
// existing payroll_entries / payroll_periods rows (nothing is recalculated
// here) plus the per-employee payment and payslip-release columns. The only
// derived things are statuses and issue flags.

export type PaymentStatus = 'PENDING' | 'FOR_APPROVAL' | 'APPROVED' | 'PAID' | 'PARTIALLY_PAID' | 'FAILED' | 'RETURNED';
export type PayslipStatus = 'DRAFT' | 'READY' | 'RELEASED' | 'VIEWED' | 'PRINTED' | 'DOWNLOADED';
export type IssueSeverity = 'error' | 'warning' | 'info';
export interface PayrollIssue { code: string; severity: IssueSeverity; message: string }

const FINAL = ['approved', 'paid', 'locked'];

export function derivePaymentStatus(entry: { payment_status: string | null }, periodStatus: string): PaymentStatus {
  if (entry.payment_status) return entry.payment_status as PaymentStatus;
  if (periodStatus === 'paid' || periodStatus === 'locked') return 'PAID';
  if (periodStatus === 'approved') return 'APPROVED';
  if (periodStatus === 'for_review') return 'FOR_APPROVAL';
  return 'PENDING';
}

export function derivePayslipStatus(
  entry: { payslip_released_at: string | null; payslip_viewed_at: string | null; payslip_printed_at: string | null; payslip_downloaded_at: string | null },
  periodStatus: string,
): PayslipStatus {
  if (entry.payslip_released_at) {
    const events: [PayslipStatus, string | null][] = [
      ['DOWNLOADED', entry.payslip_downloaded_at], ['PRINTED', entry.payslip_printed_at], ['VIEWED', entry.payslip_viewed_at],
    ];
    const latest = events.filter((e): e is [PayslipStatus, string] => !!e[1]).sort((a, b) => b[1].localeCompare(a[1]))[0];
    return latest ? latest[0] : 'RELEASED';
  }
  return FINAL.includes(periodStatus) ? 'READY' : 'DRAFT';
}

export interface MonitorEntry {
  id: number;
  employee_id: number;
  employee_name: string;
  employee_code: string;
  position: string | null;
  department: string | null;
  gross_pay: number;
  total_deductions: number;
  net_pay: number;
  payment_status: PaymentStatus;
  payslip_status: PayslipStatus;
  paid_at: string | null;
  paid_amount: number | null;
  payment_method: string | null;
  payment_reference: string | null;
  payslip_released_at: string | null;
  has_email: boolean; // an email address is on file for "Send to Employee"
  payslip_emailed_at: string | null;
  payslip_emailed_to: string | null;
  issues: PayrollIssue[];
  has_issue: boolean; // error or warning (info-level items are notes, not problems)
  // Snapshot numbers, used by the breakdown and attendance-basis dialogs.
  detail: Record<string, number | string | null>;
}

export interface MonitorPeriod {
  id: number; label: string; from_date: string; to_date: string; pay_date: string | null;
  schedule: string | null; status: string;
}

interface EntryRow {
  id: number; employee_id: number; employee_name_snapshot: string; employee_code_snapshot: string; position_snapshot: string | null;
  gross_pay: number; total_deductions: number; net_pay: number;
  payment_status: string | null; paid_amount: number | null; paid_at: string | null; payment_method: string | null; payment_reference: string | null;
  payslip_released_at: string | null; payslip_viewed_at: string | null; payslip_printed_at: string | null; payslip_downloaded_at: string | null;
  payslip_emailed_at: string | null; payslip_emailed_to: string | null;
  sss_ee_contribution: number; philhealth_ee_contribution: number; pagibig_ee_contribution: number;
  [k: string]: any;
}

const fmtPeso = (n: number) => `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function listPeriods(db: Database.Database): MonitorPeriod[] {
  return db.prepare(`
    SELECT id, label, from_date, to_date, pay_date, schedule, status FROM payroll_periods
    WHERE voided_at IS NULL ORDER BY from_date DESC, id DESC
  `).all() as MonitorPeriod[];
}

export function buildMonitor(db: Database.Database, periodId: number) {
  const period = db.prepare(`
    SELECT p.id, p.label, p.from_date, p.to_date, p.pay_date, p.schedule, p.status, p.generated_at, p.reviewed_at, p.approved_at, p.paid_at, p.locked_at, p.payslips_generated_at,
           p.return_kind, p.return_reason, p.returned_at, u.name AS returned_by_name
    FROM payroll_periods p LEFT JOIN users u ON u.id = p.returned_by WHERE p.id = ? AND p.voided_at IS NULL
  `).get(periodId) as (MonitorPeriod & Record<string, any>) | undefined;
  if (!period) return null;

  const rows = db.prepare(`SELECT * FROM payroll_entries WHERE payroll_period_id = ? ORDER BY employee_name_snapshot ASC`).all(periodId) as EntryRow[];

  const adjCount = new Map<number, number>();
  for (const r of db.prepare(`
    SELECT payroll_entry_id, COUNT(*) c FROM payroll_adjustments
    WHERE payroll_entry_id IN (SELECT id FROM payroll_entries WHERE payroll_period_id = ?) GROUP BY payroll_entry_id
  `).all(periodId) as { payroll_entry_id: number; c: number }[]) adjCount.set(r.payroll_entry_id, r.c);

  const getEmployee = db.prepare(`
    SELECT id, full_name, work_days, rest_day, salary_type, basic_rate, allowance, ot_eligible, sss_enabled, philhealth_enabled, pagibig_enabled, department, email
    FROM employees WHERE id = ?
  `);

  const attendanceMatters = !['paid', 'locked'].includes(period.status);

  const entries: MonitorEntry[] = rows.map(r => {
    const emp = getEmployee.get(r.employee_id) as (PayrollEmployee & { department: string | null; email: string | null }) | undefined;
    const paymentStatus = derivePaymentStatus(r, period.status);
    const payslipStatus = derivePayslipStatus(r, period.status);

    const issues: PayrollIssue[] = [];
    if (r.net_pay < 0) issues.push({ code: 'negative_net', severity: 'error', message: `Net pay is negative (${fmtPeso(r.net_pay)}) — deductions are more than earnings.` });
    if (paymentStatus === 'FAILED') issues.push({ code: 'payment_failed', severity: 'error', message: 'The payment for this employee failed.' });
    if (paymentStatus === 'RETURNED') issues.push({ code: 'payment_returned', severity: 'error', message: 'The payment for this employee was returned.' });
    if (paymentStatus === 'PARTIALLY_PAID') issues.push({ code: 'partially_paid', severity: 'warning', message: `Only ${fmtPeso(r.paid_amount ?? 0)} of ${fmtPeso(r.net_pay)} has been paid.` });

    if (emp && attendanceMatters) {
      for (const w of checkAttendanceWarnings(db, emp, period.from_date, period.to_date)) {
        issues.push({ code: `attendance_${w.type}`, severity: 'warning', message: `Attendance incomplete: ${w.message}` });
      }
    }
    if (emp) {
      // One note per employee, not one per program: every employee starts with
      // all three programs switched on, so per-program flags would bury the
      // page in identical warnings for anyone whose amounts haven't been set.
      const missing: string[] = [];
      if (emp.sss_enabled && !(r.sss_ee_contribution > 0)) missing.push('SSS');
      if (emp.philhealth_enabled && !(r.philhealth_ee_contribution > 0)) missing.push('PhilHealth');
      if (emp.pagibig_enabled && !(r.pagibig_ee_contribution > 0)) missing.push('Pag-IBIG');
      if (missing.length) {
        issues.push({
          code: 'gov_deductions', severity: 'warning',
          message: `Government deductions not set: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} switched on for this employee but no amount was deducted. Set the amount on their profile, or switch the program off if it does not apply.`,
        });
      }
    }
    const adj = adjCount.get(r.id) ?? 0;
    if (adj > 0) issues.push({ code: 'manual_adjustment', severity: 'info', message: `${adj} manual adjustment${adj === 1 ? '' : 's'} applied.` });
    if (!FINAL.includes(period.status)) issues.push({ code: 'not_approved', severity: 'info', message: 'Payroll is not approved yet.' });
    else if (!r.payslip_released_at) issues.push({ code: 'not_released', severity: 'info', message: 'Payslip is not released to the employee yet.' });

    return {
      id: r.id, employee_id: r.employee_id, employee_name: r.employee_name_snapshot, employee_code: r.employee_code_snapshot,
      position: r.position_snapshot, department: emp?.department ?? null,
      gross_pay: r.gross_pay, total_deductions: r.total_deductions, net_pay: r.net_pay,
      payment_status: paymentStatus, payslip_status: payslipStatus,
      paid_at: r.paid_at, paid_amount: r.paid_amount, payment_method: r.payment_method, payment_reference: r.payment_reference,
      payslip_released_at: r.payslip_released_at,
      has_email: isValidEmail(emp?.email), payslip_emailed_at: r.payslip_emailed_at, payslip_emailed_to: r.payslip_emailed_to,
      issues, has_issue: issues.some(i => i.severity !== 'info'),
      detail: {
        salary_type: r.salary_type_snapshot, basic_rate: r.basic_rate_snapshot,
        work_days_count: r.work_days_count, late_minutes: r.late_minutes, undertime_minutes: r.undertime_minutes,
        excess_break_minutes: r.excess_break_minutes, absence_days: r.absence_days, unpaid_leave_days: r.unpaid_leave_days,
        approved_ot_minutes: r.approved_ot_minutes,
        basic_pay: r.basic_pay, ot_pay: r.ot_pay, allowance_pay: r.allowance_pay, bonus_earnings: r.bonus_earnings,
        late_deduction: r.late_deduction, undertime_deduction: r.undertime_deduction, excess_break_deduction: r.excess_break_deduction,
        absence_deduction: r.absence_deduction, unpaid_leave_deduction: r.unpaid_leave_deduction, other_deductions: r.other_deductions,
        sss_ee: r.sss_ee_contribution, philhealth_ee: r.philhealth_ee_contribution, pagibig_ee: r.pagibig_ee_contribution,
      },
    };
  });

  const sum = (f: (r: EntryRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  const gross = sum(r => r.gross_pay), deductions = sum(r => r.total_deductions), net = sum(r => r.net_pay);

  const paidCount = entries.filter(e => e.payment_status === 'PAID').length;
  const releasedCount = entries.filter(e => !!e.payslip_released_at).length;
  const summary = {
    total_net: net, employees: entries.length,
    paid: paidCount, pending_payment: entries.length - paidCount,
    released: releasedCount, with_issues: entries.filter(e => e.has_issue).length,
  };

  // Previous payroll for the comparison: the closest earlier, non-voided
  // period on the same schedule (or any schedule when this one has none).
  const prev = (period.schedule
    ? db.prepare(`SELECT id, label FROM payroll_periods WHERE voided_at IS NULL AND schedule = ? AND from_date < ? ORDER BY from_date DESC, id DESC LIMIT 1`).get(period.schedule, period.from_date)
    : db.prepare(`SELECT id, label FROM payroll_periods WHERE voided_at IS NULL AND from_date < ? ORDER BY from_date DESC, id DESC LIMIT 1`).get(period.from_date)
  ) as { id: number; label: string } | undefined;
  let previous: { label: string; gross: number; deductions: number; net: number; difference: number; percent: number | null } | null = null;
  if (prev) {
    const t = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(gross_pay),0) g, COALESCE(SUM(total_deductions),0) d, COALESCE(SUM(net_pay),0) n FROM payroll_entries WHERE payroll_period_id = ?`).get(prev.id) as { c: number; g: number; d: number; n: number };
    if (t.c > 0) {
      previous = { label: prev.label, gross: t.g, deductions: t.d, net: t.n, difference: net - t.n, percent: t.n > 0 ? ((net - t.n) / t.n) * 100 : null };
    }
  }

  // Cost breakdown — straight sums of what payroll already stored per entry.
  const adjByType = new Map<string, number>();
  for (const r of db.prepare(`
    SELECT adjustment_type t, COALESCE(SUM(amount),0) a FROM payroll_adjustments
    WHERE payroll_entry_id IN (SELECT id FROM payroll_entries WHERE payroll_period_id = ?) GROUP BY adjustment_type
  `).all(periodId) as { t: string; a: number }[]) adjByType.set(r.t, r.a);
  const breakdown = {
    earnings: [
      { key: 'basic_pay', label: 'Basic Pay', amount: sum(r => r.basic_pay) },
      { key: 'ot_pay', label: 'Overtime Pay', amount: sum(r => r.ot_pay) },
      { key: 'allowance_pay', label: 'Allowances', amount: sum(r => r.allowance_pay) },
      { key: 'bonus_earnings', label: 'Bonus & Other Earnings', amount: sum(r => r.bonus_earnings) },
    ],
    deductions: [
      { key: 'late', label: 'Late', amount: sum(r => r.late_deduction) },
      { key: 'undertime', label: 'Undertime', amount: sum(r => r.undertime_deduction) },
      { key: 'excess_break', label: 'Excess Break', amount: sum(r => r.excess_break_deduction) },
      { key: 'absence', label: 'Absences', amount: sum(r => r.absence_deduction) },
      { key: 'unpaid_leave', label: 'Unpaid Leave', amount: sum(r => r.unpaid_leave_deduction) },
      { key: 'cash_advance', label: 'Cash Advances', amount: adjByType.get('cash_advance') ?? 0 },
      { key: 'loan', label: 'Salary / Loan Deductions', amount: adjByType.get('loan_deduction') ?? 0 },
      { key: 'other', label: 'Other Deductions', amount: adjByType.get('other_deduction') ?? 0 },
      { key: 'sss', label: 'SSS', amount: sum(r => r.sss_ee_contribution) },
      { key: 'philhealth', label: 'PhilHealth', amount: sum(r => r.philhealth_ee_contribution) },
      { key: 'pagibig', label: 'Pag-IBIG', amount: sum(r => r.pagibig_ee_contribution) },
    ],
    total_gross: gross, total_deductions: deductions, total_net: net,
  };

  const activity = db.prepare(`
    SELECT l.id, l.action, l.details, l.created_at, l.payroll_entry_id, u.name AS actor_name, e.employee_name_snapshot AS employee_name
    FROM payroll_audit_log l
    LEFT JOIN users u ON u.id = l.actor_user_id
    LEFT JOIN payroll_entries e ON e.id = l.payroll_entry_id
    WHERE l.payroll_period_id = ? ORDER BY l.id DESC LIMIT 100
  `).all(periodId);

  return {
    period: {
      ...period, released_all: entries.length > 0 && releasedCount === entries.length,
      // Owner may reopen an approved payroll only while nothing depends on it.
      can_reopen: period.status === 'approved' && entries.every(e => !e.payslip_released_at && e.payment_status !== 'PAID' && e.payment_status !== 'PARTIALLY_PAID' && e.payment_status !== 'FAILED' && e.payment_status !== 'RETURNED'),
    },
    entries, summary,
    owner: { gross, deductions, net, previous },
    breakdown, activity,
  };
}
