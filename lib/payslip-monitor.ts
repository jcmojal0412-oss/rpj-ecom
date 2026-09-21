import type Database from 'better-sqlite3';
import { checkAttendanceWarnings, type PayrollEmployee } from './payroll-data';
import { isValidEmail, payslipCopyRecipients } from './payslip-email';
import { netMismatch } from './payslip-integrity';

// Everything the Payslips & Payroll Monitoring page shows is READ from the
// existing payroll_entries / payroll_periods rows (nothing is recalculated
// here) plus the per-employee payment and payslip-release columns. The only
// derived things are statuses and issue flags.
//
// Two separate ideas are kept apart on purpose:
//   PAYROLL RUN status (draft / for approval / approved / paid / payslips released)
//     — belongs to the whole pay period.
//   EMPLOYEE payment status (pending / paid / partially paid / failed / returned)
//     — whether THAT person has actually been paid. Whether the run is still
//       awaiting approval is a run concern and never shows up here.

export type PaymentStatus = 'PENDING' | 'PAID' | 'PARTIALLY_PAID' | 'FAILED' | 'RETURNED';
export type PayslipStatus = 'DRAFT' | 'READY' | 'RELEASED' | 'VIEWED' | 'PRINTED' | 'DOWNLOADED';
export type IssueSeverity = 'error' | 'warning' | 'info';
// What the user can do about it: where the "fix it" button on the issue leads.
export type IssueAction = 'review_attendance' | 'open_employee' | 'edit_payroll' | null;
export interface PayrollIssue { code: string; severity: IssueSeverity; title: string; message: string; action: IssueAction }

const FINAL = ['approved', 'paid', 'locked'];

export function derivePaymentStatus(entry: { payment_status: string | null }, periodStatus: string): PaymentStatus {
  if (entry.payment_status) return entry.payment_status as PaymentStatus;
  if (periodStatus === 'paid' || periodStatus === 'locked') return 'PAID';
  return 'PENDING';
}

// Released -> Viewed happens when the EMPLOYEE opens it (HR opening it never
// counts, see /api/payslips/[id]). Printed / Downloaded only show while the
// employee hasn't opened it yet, so HR printing a copy can't hide a real view.
export function derivePayslipStatus(
  entry: { payslip_released_at: string | null; payslip_viewed_at: string | null; payslip_printed_at: string | null; payslip_downloaded_at: string | null },
  periodStatus: string,
): PayslipStatus {
  if (entry.payslip_released_at) {
    if (entry.payslip_viewed_at) return 'VIEWED';
    const events: [PayslipStatus, string | null][] = [['DOWNLOADED', entry.payslip_downloaded_at], ['PRINTED', entry.payslip_printed_at]];
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
  payslip_ref: string | null; // "PS-20260915-00012", searchable by HR
  position: string | null;
  department: string | null;
  gross_pay: number;
  total_deductions: number;
  net_pay: number;
  payment_status: PaymentStatus;
  payslip_status: PayslipStatus;
  paid_at: string | null;
  payment_date: string | null;
  paid_amount: number | null;
  payment_method: string | null;
  payment_reference: string | null;
  paid_by_name: string | null;
  payslip_released_at: string | null;
  payslip_first_viewed_at: string | null;
  payslip_last_viewed_at: string | null;
  has_email: boolean; // an email address is on file for "Send to Employee"
  payslip_emailed_at: string | null;
  payslip_emailed_to: string | null;
  // null = sent before delivery tracking existed
  payslip_email_status: 'sent' | 'delayed' | 'delivered' | 'bounced' | 'complained' | 'failed' | null;
  payslip_email_status_at: string | null;
  issues: PayrollIssue[];
  has_issue: boolean; // a real problem (error or warning); info-level notes don't count
  // Snapshot numbers, used by the details and attendance-basis dialogs.
  detail: Record<string, number | string | null>;
}

export interface MonitorPeriod {
  id: number; label: string; from_date: string; to_date: string; pay_date: string | null;
  schedule: string | null; status: string;
}

interface EntryRow {
  id: number; employee_id: number; employee_name_snapshot: string; employee_code_snapshot: string; position_snapshot: string | null;
  gross_pay: number; total_deductions: number; net_pay: number;
  payment_status: string | null; paid_amount: number | null; paid_at: string | null; paid_by: number | null; payment_date: string | null;
  payment_method: string | null; payment_reference: string | null;
  payslip_released_at: string | null; payslip_viewed_at: string | null; payslip_last_viewed_at: string | null; payslip_printed_at: string | null; payslip_downloaded_at: string | null;
  payslip_emailed_at: string | null; payslip_emailed_to: string | null;
  sss_ee_contribution: number; philhealth_ee_contribution: number; pagibig_ee_contribution: number;
  [k: string]: any;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const fmtPeso = (n: number) => `${n < 0 ? '−' : ''}₱${Math.abs(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const shortDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-PH', { timeZone: 'UTC', month: 'short', day: 'numeric' });
};
const daysInPeriod = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;

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
  const getUserName = db.prepare('SELECT name FROM users WHERE id = ?');

  // Once payroll is approved its amounts and attendance basis are frozen, so
  // "fix the attendance / the deduction setup" is only actionable while it is
  // still being prepared.
  const editable = !FINAL.includes(period.status);

  // A government deduction only counts as "missing" when it is switched on for
  // this employee, their amount is ₱0, AND the company clearly deducts that
  // program from others in this same payroll. If nobody has it deducted, the
  // programs simply aren't in use and ₱0 is normal, not a setup problem.
  const programInUse = {
    sss: rows.some(r => r.sss_ee_contribution > 0),
    philhealth: rows.some(r => r.philhealth_ee_contribution > 0),
    pagibig: rows.some(r => r.pagibig_ee_contribution > 0),
  };

  const entries: MonitorEntry[] = rows.map(r => {
    const emp = getEmployee.get(r.employee_id) as (PayrollEmployee & { department: string | null; email: string | null }) | undefined;
    const paymentStatus = derivePaymentStatus(r, period.status);
    const payslipStatus = derivePayslipStatus(r, period.status);

    const issues: PayrollIssue[] = [];

    // ---- calculation checks ----
    const mismatch = netMismatch(r);
    if (mismatch) {
      issues.push({
        code: 'calc_mismatch', severity: 'error', title: 'Payroll calculation does not add up', action: 'edit_payroll',
        message: `Gross ${fmtPeso(r.gross_pay)} − deductions ${fmtPeso(r.total_deductions)} should be ${fmtPeso(mismatch.expected)}, but net pay is ${fmtPeso(r.net_pay)}.`,
      });
    }
    if (r.net_pay < 0) {
      issues.push({ code: 'negative_net', severity: 'error', title: 'Negative net pay', action: 'edit_payroll', message: `Net pay is ${fmtPeso(r.net_pay)} — deductions are more than earnings.` });
    }

    // ---- payment problems (real, need follow-up) ----
    if (paymentStatus === 'FAILED') issues.push({ code: 'payment_failed', severity: 'error', title: 'Payment failed', action: null, message: 'The payment for this employee failed. Record it again once it goes through.' });
    if (paymentStatus === 'RETURNED') issues.push({ code: 'payment_returned', severity: 'error', title: 'Payment returned', action: null, message: 'The payment for this employee was returned. Record it again once it is re-sent.' });
    if (paymentStatus === 'PARTIALLY_PAID') issues.push({ code: 'partially_paid', severity: 'warning', title: 'Only partly paid', action: null, message: `Only ${fmtPeso(r.paid_amount ?? 0)} of ${fmtPeso(r.net_pay)} has been paid.` });

    // ---- payslip email that did not reach the employee ----
    if (r.payslip_email_status === 'bounced' || r.payslip_email_status === 'failed') {
      issues.push({
        code: 'email_undelivered', severity: 'warning', title: 'Payslip email not delivered', action: 'open_employee',
        message: `The payslip email to ${r.payslip_emailed_to ?? 'the employee'} ${r.payslip_email_status === 'bounced' ? 'bounced' : 'failed to send'}. Check their email address, then send it again.`,
      });
    }

    // ---- attendance / setup (only while payroll can still be corrected) ----
    if (emp && editable) {
      const warnings = checkAttendanceWarnings(db, emp, period.from_date, period.to_date);
      const missingOut = warnings.filter(w => w.type === 'missing_time_out' && w.date).map(w => shortDate(w.date as string));
      if (missingOut.length) {
        issues.push({ code: 'attendance_missing_time_out', severity: 'warning', title: 'Attendance incomplete', action: 'review_attendance', message: `Missing time-out: ${missingOut.join(', ')}.` });
      }
      for (const w of warnings) {
        if (w.type === 'pending_correction') issues.push({ code: 'attendance_pending_correction', severity: 'warning', title: 'Attendance incomplete', action: 'review_attendance', message: `${w.count} attendance correction request${w.count === 1 ? '' : 's'} waiting for approval.` });
        else if (w.type === 'pending_ot') issues.push({ code: 'attendance_pending_ot', severity: 'warning', title: 'Overtime not yet approved', action: 'review_attendance', message: `${w.count} overtime request${w.count === 1 ? '' : 's'} waiting for approval — not included in pay until approved.` });
        else if (w.type === 'pending_leave') issues.push({ code: 'attendance_pending_leave', severity: 'warning', title: 'Leave not yet approved', action: 'review_attendance', message: `${w.count} leave request${w.count === 1 ? '' : 's'} overlapping this period waiting for approval.` });
        else if (w.type === 'missing_rate') issues.push({ code: 'missing_rate', severity: 'warning', title: 'Missing salary setup', action: 'open_employee', message: 'No salary / rate is set for this employee.' });
      }

      const missing: string[] = [];
      if (emp.sss_enabled && programInUse.sss && !(r.sss_ee_contribution > 0)) missing.push('SSS');
      if (emp.philhealth_enabled && programInUse.philhealth && !(r.philhealth_ee_contribution > 0)) missing.push('PhilHealth');
      if (emp.pagibig_enabled && programInUse.pagibig && !(r.pagibig_ee_contribution > 0)) missing.push('Pag-IBIG');
      if (missing.length) {
        issues.push({
          code: 'gov_deductions', severity: 'warning', title: 'Government deduction not set', action: 'open_employee',
          message: `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} deducted from other employees in this payroll but ₱0 here. Set the amount on their profile, or switch it off if it does not apply.`,
        });
      }
    }

    // ---- notes (never counted as issues) ----
    const adj = adjCount.get(r.id) ?? 0;
    if (r.payslip_email_status === 'complained') issues.push({ code: 'email_spam', severity: 'info', title: 'Marked as spam', action: null, message: 'The employee marked the payslip email as spam.' });
    if (adj > 0) issues.push({ code: 'manual_adjustment', severity: 'info', title: 'Manual adjustment', action: null, message: `${adj} manual adjustment${adj === 1 ? '' : 's'} applied.` });

    return {
      id: r.id, employee_id: r.employee_id, employee_name: r.employee_name_snapshot, employee_code: r.employee_code_snapshot, payslip_ref: (r.payslip_ref ?? null) as string | null,
      position: r.position_snapshot, department: emp?.department ?? null,
      gross_pay: r.gross_pay, total_deductions: r.total_deductions, net_pay: r.net_pay,
      payment_status: paymentStatus, payslip_status: payslipStatus,
      paid_at: r.paid_at, payment_date: r.payment_date, paid_amount: r.paid_amount, payment_method: r.payment_method, payment_reference: r.payment_reference,
      paid_by_name: r.paid_by ? ((getUserName.get(r.paid_by) as { name: string } | undefined)?.name ?? null) : null,
      payslip_released_at: r.payslip_released_at, payslip_first_viewed_at: r.payslip_viewed_at, payslip_last_viewed_at: r.payslip_last_viewed_at,
      has_email: isValidEmail(emp?.email), payslip_emailed_at: r.payslip_emailed_at, payslip_emailed_to: r.payslip_emailed_to,
      payslip_email_status: (r.payslip_email_status ?? null) as MonitorEntry['payslip_email_status'], payslip_email_status_at: r.payslip_email_status_at ?? null,
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
  // The peso difference and percentage are only shown when the two runs are
  // genuinely comparable — same schedule, about the same number of days, and
  // the same headcount — otherwise a partial run against a full one would just
  // read as a huge, meaningless jump.
  const prev = (period.schedule
    ? db.prepare(`SELECT id, label, from_date, to_date, schedule FROM payroll_periods WHERE voided_at IS NULL AND schedule = ? AND from_date < ? ORDER BY from_date DESC, id DESC LIMIT 1`).get(period.schedule, period.from_date)
    : db.prepare(`SELECT id, label, from_date, to_date, schedule FROM payroll_periods WHERE voided_at IS NULL AND from_date < ? ORDER BY from_date DESC, id DESC LIMIT 1`).get(period.from_date)
  ) as { id: number; label: string; from_date: string; to_date: string; schedule: string | null } | undefined;
  let previous: {
    label: string; gross: number; deductions: number; net: number; employees: number;
    comparable: boolean; not_comparable_reason: string | null; difference: number | null; percent: number | null;
  } | null = null;
  if (prev) {
    const t = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(gross_pay),0) g, COALESCE(SUM(total_deductions),0) d, COALESCE(SUM(net_pay),0) n FROM payroll_entries WHERE payroll_period_id = ?`).get(prev.id) as { c: number; g: number; d: number; n: number };
    if (t.c > 0) {
      let reason: string | null = null;
      if ((prev.schedule ?? null) !== (period.schedule ?? null)) reason = 'a different payroll schedule';
      else if (Math.abs(daysInPeriod(prev.from_date, prev.to_date) - daysInPeriod(period.from_date, period.to_date)) > 2) reason = `a different period length (${daysInPeriod(prev.from_date, prev.to_date)} vs ${daysInPeriod(period.from_date, period.to_date)} days)`;
      else if (t.c !== entries.length) reason = `a different number of employees (${t.c} vs ${entries.length})`;
      const comparable = reason === null;
      previous = {
        label: prev.label, gross: t.g, deductions: t.d, net: t.n, employees: t.c,
        comparable, not_comparable_reason: reason,
        difference: comparable ? round2(net - t.n) : null,
        percent: comparable && t.n > 0 ? ((net - t.n) / t.n) * 100 : null,
      };
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
    WHERE l.payroll_period_id = ? ORDER BY l.id DESC LIMIT 200
  `).all(periodId);

  return {
    period: {
      ...period, released_all: entries.length > 0 && releasedCount === entries.length,
      // Owner may reopen an approved payroll only while nothing depends on it.
      can_reopen: period.status === 'approved' && entries.every(e => !e.payslip_released_at && e.payment_status === 'PENDING'),
    },
    entries, summary,
    // What the send dialog tells HR about how emails are handled.
    email_setup: { copy_to: payslipCopyRecipients(), tracking: !!process.env.RESEND_WEBHOOK_SECRET },
    owner: { gross, deductions, net, previous },
    breakdown, activity,
  };
}
