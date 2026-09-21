import type Database from 'better-sqlite3';
import { netMismatch } from './payslip-integrity';

// Owner-level MONTHLY PAYROLL EXPENSE report. A pure reporting layer: it only
// READS the figures each payroll_entries row froze when payroll was generated
// (basic/OT/allowance/bonus, deductions, employer contributions, department
// snapshot). Nothing is recomputed from current salary rates or employee
// settings, so a past month always reads the way it did when it was paid.
//
//   Total Payroll Expense = Gross Pay + Employer Contributions
//     (Gross Pay = Basic + Overtime + Allowance + Bonus/other earnings as they
//      appear on the payslip; Employer Contributions = SSS ER + SSS EC +
//      PhilHealth ER + Pag-IBIG ER.)
//   Employee deductions are NOT subtracted from it (they are shown for
//   reference only), and it is never Net Pay.

export type Basis = 'paid' | 'approved_paid' | 'all';
export type GroupBy = 'period_end' | 'pay_date';

export const BASIS_LABEL: Record<Basis, string> = {
  paid: 'Paid payroll runs only',
  approved_paid: 'Approved + Paid payroll runs',
  all: 'All payroll runs (including drafts)',
};
const BASIS_STATUSES: Record<Basis, string[]> = {
  paid: ['paid', 'locked'],
  approved_paid: ['approved', 'paid', 'locked'],
  all: ['draft', 'for_review', 'approved', 'paid', 'locked'],
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const sumOf = <T,>(rows: T[], f: (r: T) => number) => round2(rows.reduce((s, r) => s + (Number(f(r)) || 0), 0));

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthLabel = (m: string) => { const [y, mo] = m.split('-').map(Number); return `${MONTHS[mo - 1]} ${y}`; };
const monthEnd = (m: string) => { const [y, mo] = m.split('-').map(Number); return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`; };
const addMonths = (m: string, n: number) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
const fmtLongDate = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return `${MONTHS[m - 1].slice(0, 3)} ${d}, ${y}`; };

// Departments are typed by hand ("SALES", "Sales "): group them case-insensitively.
export const deptKey = (d: string | null | undefined) => (d ?? '').trim().toLowerCase();
// A blank department is the "Unassigned" bucket, so it can be picked in the filter too.
const filterKey = (d: string | null | undefined) => deptKey(d) || 'unassigned';
export function deptLabel(d: string | null | undefined): string {
  const t = (d ?? '').trim();
  if (!t) return 'Unassigned';
  return t.split(/\s+/).map(w => (w.length <= 3 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join(' ');
}

interface Row {
  id: number; employee_id: number; employee_name_snapshot: string; employee_code_snapshot: string;
  basic_pay: number; ot_pay: number; allowance_pay: number; bonus_earnings: number; gross_pay: number;
  late_deduction: number; undertime_deduction: number; excess_break_deduction: number; absence_deduction: number; unpaid_leave_deduction: number; other_deductions: number;
  total_deductions: number; net_pay: number; approved_ot_minutes: number;
  sss_ee_contribution: number; sss_er_contribution: number; sss_ec_contribution: number;
  philhealth_ee_contribution: number; philhealth_er_contribution: number; pagibig_ee_contribution: number; pagibig_er_contribution: number;
  payment_status: string | null; paid_amount: number | null; department_snapshot: string | null;
  period_id: number; label: string; from_date: string; to_date: string; pay_date: string | null; schedule: string | null; period_status: string;
}

const monthOf = (r: Row, group: GroupBy) => (group === 'pay_date' ? (r.pay_date || r.to_date) : r.to_date).slice(0, 7);

function totals(rows: Row[]) {
  const t = {
    basic: sumOf(rows, r => r.basic_pay), overtime: sumOf(rows, r => r.ot_pay), allowance: sumOf(rows, r => r.allowance_pay), bonus: sumOf(rows, r => r.bonus_earnings),
    gross: sumOf(rows, r => r.gross_pay), deductions: sumOf(rows, r => r.total_deductions), net: sumOf(rows, r => r.net_pay),
    sssEe: sumOf(rows, r => r.sss_ee_contribution), phEe: sumOf(rows, r => r.philhealth_ee_contribution), pagibigEe: sumOf(rows, r => r.pagibig_ee_contribution),
    late: sumOf(rows, r => r.late_deduction), undertime: sumOf(rows, r => r.undertime_deduction), excessBreak: sumOf(rows, r => r.excess_break_deduction),
    absence: sumOf(rows, r => r.absence_deduction), unpaidLeave: sumOf(rows, r => r.unpaid_leave_deduction), otherDeductions: sumOf(rows, r => r.other_deductions),
    sssEr: sumOf(rows, r => r.sss_er_contribution), sssEc: sumOf(rows, r => r.sss_ec_contribution), phEr: sumOf(rows, r => r.philhealth_er_contribution), pagibigEr: sumOf(rows, r => r.pagibig_er_contribution),
    otMinutes: rows.reduce((s, r) => s + (r.approved_ot_minutes || 0), 0),
  };
  const employer = round2(t.sssEr + t.sssEc + t.phEr + t.pagibigEr);
  return { ...t, employer, expense: round2(t.gross + employer) };
}

export interface ExpenseOptions {
  month: string;                 // YYYY-MM
  basis?: Basis;
  groupBy?: GroupBy;
  schedule?: string | null;      // 'A' | 'B' | null (= all)
  department?: string | null;    // department label/key | null (= all)
  today: string;                 // YYYY-MM-DD, Philippine time
}

export function buildMonthlyExpense(db: Database.Database, opts: ExpenseOptions) {
  const basis: Basis = opts.basis && BASIS_STATUSES[opts.basis] ? opts.basis : 'approved_paid';
  const groupBy: GroupBy = opts.groupBy === 'pay_date' ? 'pay_date' : 'period_end';
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(opts.month) ? opts.month : opts.today.slice(0, 7);
  const schedule = opts.schedule === 'A' || opts.schedule === 'B' ? opts.schedule : null;
  const deptFilter = opts.department ? filterKey(opts.department) : null;
  const today = opts.today;

  // Everything within ~14 months of the selected one (trend window + slack for
  // pay dates that fall in the next month); exact month membership is decided below.
  const windowStart = `${addMonths(month, -13)}-01`;
  const windowEnd = `${addMonths(month, 2)}-01`;
  const all = db.prepare(`
    SELECT e.*, p.id AS period_id, p.label, p.from_date, p.to_date, p.pay_date, p.schedule, p.status AS period_status
    FROM payroll_entries e JOIN payroll_periods p ON p.id = e.payroll_period_id
    WHERE p.voided_at IS NULL AND p.to_date >= ? AND p.to_date < ?
    ORDER BY p.to_date ASC, p.id ASC, e.employee_name_snapshot ASC
  `).all(windowStart, windowEnd) as Row[];

  const inScope = (r: Row) => (!schedule || r.schedule === schedule) && (!deptFilter || filterKey(r.department_snapshot) === deptFilter);
  const scoped = all.filter(inScope);
  const withBasis = (rows: Row[]) => rows.filter(r => BASIS_STATUSES[basis].includes(r.period_status));

  const monthRows = withBasis(scoped.filter(r => monthOf(r, groupBy) === month));
  const monthRowsAllRuns = scoped.filter(r => monthOf(r, groupBy) === month);
  const t = totals(monthRows);
  const employeeIds = new Set(monthRows.map(r => r.employee_id));
  const employees = employeeIds.size;

  // ---- month status: complete, or month-to-date ----
  const end = monthEnd(month);
  const isPartial = today <= end;
  const isFuture = today < `${month}-01`;

  // ---- runs included ----
  const runMap = new Map<number, Row[]>();
  for (const r of monthRows) (runMap.get(r.period_id) ?? runMap.set(r.period_id, []).get(r.period_id)!).push(r);
  const runs = [...runMap.values()].map(rows => {
    const rt = totals(rows), first = rows[0];
    return { id: first.period_id, label: first.label, from_date: first.from_date, to_date: first.to_date, pay_date: first.pay_date, schedule: first.schedule, status: first.period_status,
      employees: rows.length, gross: rt.gross, net: rt.net, employer: rt.employer, total_expense: rt.expense };
  }).sort((a, b) => a.from_date.localeCompare(b.from_date));

  // ---- trend / history: 12 months ending at the selected month ----
  const trend = Array.from({ length: 12 }, (_, i) => {
    const m = addMonths(month, i - 11);
    const rows = withBasis(scoped.filter(r => monthOf(r, groupBy) === m));
    const tt = totals(rows);
    return {
      month: m, label: monthLabel(m), short: MONTHS[Number(m.slice(5)) - 1].slice(0, 3), total_expense: tt.expense, net_payroll: tt.net,
      runs: new Set(rows.map(r => r.period_id)).size, employees: new Set(rows.map(r => r.employee_id)).size, partial: today <= monthEnd(m),
    };
  });

  // ---- month-over-month ----
  const prevMonth = addMonths(month, -1);
  const prevRowsFull = withBasis(scoped.filter(r => monthOf(r, groupBy) === prevMonth));
  const cur = trend[11], prev = trend[10];
  let comparison: {
    current: { label: string; total: number; runs: number }; previous: { label: string; total: number; runs: number } | null;
    mode: 'full' | 'month_to_date'; difference: number | null; percent: number | null; comparable: boolean; reason: string | null;
  };
  if (prevRowsFull.length === 0) {
    comparison = { current: { label: cur.label, total: cur.total_expense, runs: cur.runs }, previous: null, mode: isPartial ? 'month_to_date' : 'full', difference: null, percent: null, comparable: false, reason: `No payroll recorded for ${monthLabel(prevMonth)} on this basis.` };
  } else if (isPartial) {
    // Month-to-date: only the previous month's runs that ended by the same day of the month.
    const dayNo = Number(today.slice(8, 10));
    const dayOf = (r: Row) => Number((groupBy === 'pay_date' ? (r.pay_date || r.to_date) : r.to_date).slice(8, 10));
    const prevMtd = prevRowsFull.filter(r => dayOf(r) <= dayNo);
    const ptt = totals(prevMtd), pruns = new Set(prevMtd.map(r => r.period_id)).size;
    const sameScope = pruns === cur.runs && pruns > 0;
    comparison = {
      current: { label: `${cur.label} (to ${fmtLongDate(today)})`, total: cur.total_expense, runs: cur.runs },
      previous: { label: `${prev.label} (to day ${dayNo})`, total: ptt.expense, runs: pruns }, mode: 'month_to_date',
      difference: sameScope ? round2(cur.total_expense - ptt.expense) : null,
      percent: sameScope && ptt.expense > 0 ? ((cur.total_expense - ptt.expense) / ptt.expense) * 100 : null,
      comparable: sameScope,
      reason: sameScope ? null : `Current month is incomplete (data through ${fmtLongDate(today)}) and covers ${cur.runs} payroll run${cur.runs === 1 ? '' : 's'}, while the same point last month covers ${pruns}.`,
    };
  } else {
    const sameScope = cur.runs === prev.runs && cur.runs > 0;
    comparison = {
      current: { label: cur.label, total: cur.total_expense, runs: cur.runs }, previous: { label: prev.label, total: prev.total_expense, runs: prev.runs }, mode: 'full',
      difference: sameScope ? round2(cur.total_expense - prev.total_expense) : null,
      percent: sameScope && prev.total_expense > 0 ? ((cur.total_expense - prev.total_expense) / prev.total_expense) * 100 : null,
      comparable: sameScope,
      reason: sameScope ? null : `${cur.label} has ${cur.runs} payroll run${cur.runs === 1 ? '' : 's'} on this basis while ${prev.label} has ${prev.runs} — a different payroll scope.`,
    };
  }

  // ---- departments ----
  const deptMap = new Map<string, Row[]>();
  for (const r of monthRows) { const k = deptKey(r.department_snapshot) || '__none'; (deptMap.get(k) ?? deptMap.set(k, []).get(k)!).push(r); }
  const departments = [...deptMap.entries()].map(([, rows]) => {
    const dt = totals(rows);
    return { department: deptLabel(rows[0].department_snapshot), employees: new Set(rows.map(r => r.employee_id)).size, gross: dt.gross, employer: dt.employer, net: dt.net, total_expense: dt.expense,
      percent: t.expense > 0 ? (dt.expense / t.expense) * 100 : 0, overtime: dt.overtime };
  }).sort((a, b) => b.total_expense - a.total_expense);

  // ---- employee table ----
  const empMap = new Map<number, Row[]>();
  for (const r of monthRows) (empMap.get(r.employee_id) ?? empMap.set(r.employee_id, []).get(r.employee_id)!).push(r);
  const employeeRows = [...empMap.entries()].map(([id, rows]) => {
    const et = totals(rows), last = rows[rows.length - 1];
    return {
      employee_id: id, name: last.employee_name_snapshot, code: last.employee_code_snapshot, department: deptLabel(last.department_snapshot), runs: new Set(rows.map(r => r.period_id)).size,
      basic: et.basic, overtime: et.overtime, allowances: round2(et.allowance + et.bonus), gross: et.gross, employer: et.employer, net: et.net, total_cost: et.expense, ot_minutes: et.otMinutes,
    };
  }).sort((a, b) => b.total_cost - a.total_cost);

  // ---- adjustments (drill-down for allowances / bonuses, and loan / cash-advance split) ----
  const entryIds = monthRows.map(r => r.id);
  const adj = entryIds.length
    ? db.prepare(`SELECT payroll_entry_id, adjustment_type, amount FROM payroll_adjustments WHERE payroll_entry_id IN (${entryIds.map(() => '?').join(',')})`).all(...entryIds) as { payroll_entry_id: number; adjustment_type: string; amount: number }[]
    : [];
  const adjBy = (type: string) => round2(adj.filter(a => a.adjustment_type === type).reduce((s, a) => s + a.amount, 0));
  const EARN = ['bonus', 'incentive', 'additional_allowance', 'other_earning'];
  const allowances = {
    recurring_allowance: t.allowance,
    bonuses: [
      { key: 'bonus', label: 'Bonus', amount: adjBy('bonus') }, { key: 'incentive', label: 'Incentive', amount: adjBy('incentive') },
      { key: 'additional_allowance', label: 'Additional Allowance', amount: adjBy('additional_allowance') }, { key: 'other_earning', label: 'Salary Adjustment / Other', amount: adjBy('other_earning') },
    ],
    total: round2(t.allowance + t.bonus),
  };

  // ---- overtime ----
  const otEmployees = employeeRows.filter(e => e.overtime > 0);
  const overtime = {
    hours: round2(t.otMinutes / 60), cost: t.overtime, employees_with_ot: otEmployees.length,
    avg_cost_per_employee: otEmployees.length ? round2(t.overtime / otEmployees.length) : 0,
    top: [...otEmployees].sort((a, b) => b.overtime - a.overtime).slice(0, 5).map(e => ({ employee_id: e.employee_id, name: e.name, department: e.department, hours: round2(e.ot_minutes / 60), cost: e.overtime })),
  };

  // ---- breakdown ----
  const breakdown = {
    earnings: [
      { key: 'basic', label: 'Basic Pay', amount: t.basic }, { key: 'overtime', label: 'Overtime', amount: t.overtime },
      { key: 'allowance', label: 'Allowances', amount: t.allowance }, { key: 'bonus', label: 'Bonuses & Other Earnings', amount: t.bonus },
    ],
    gross: t.gross,
    employer: [
      { key: 'sss_er', label: 'SSS — Employer Share', amount: t.sssEr }, { key: 'sss_ec', label: 'SSS EC (Employees’ Compensation)', amount: t.sssEc },
      { key: 'philhealth_er', label: 'PhilHealth — Employer Share', amount: t.phEr }, { key: 'pagibig_er', label: 'Pag-IBIG — Employer Share', amount: t.pagibigEr },
    ],
    employer_total: t.employer,
    total_expense: t.expense,
    deductions: [
      { key: 'sss_ee', label: 'SSS — Employee Share', amount: t.sssEe }, { key: 'philhealth_ee', label: 'PhilHealth — Employee Share', amount: t.phEe }, { key: 'pagibig_ee', label: 'Pag-IBIG — Employee Share', amount: t.pagibigEe },
      { key: 'late', label: 'Late', amount: t.late }, { key: 'undertime', label: 'Undertime', amount: t.undertime }, { key: 'excess_break', label: 'Excess Break', amount: t.excessBreak },
      { key: 'absence', label: 'Absences', amount: t.absence }, { key: 'unpaid_leave', label: 'Unpaid Leave', amount: t.unpaidLeave },
      { key: 'cash_advance', label: 'Cash Advances', amount: adjBy('cash_advance') }, { key: 'loan', label: 'Loans / Salary Deductions', amount: adjBy('loan_deduction') }, { key: 'other', label: 'Other Deductions', amount: adjBy('other_deduction') },
    ],
    deductions_total: t.deductions,
    net: t.net,
    time_deductions: round2(t.late + t.undertime + t.excessBreak + t.absence + t.unpaidLeave),
    // What payroll does not track today — listed instead of guessed.
    not_tracked: ['Holiday pay', 'Rest-day pay', 'Night differential', 'Commissions', 'Withholding tax'],
  };

  // ---- payroll cash requirement: every run of the month (any status), net salaries ----
  let paid = 0, approvedUnpaid = 0, awaiting = 0;
  for (const r of monthRowsAllRuns) {
    const net = Math.max(0, r.net_pay);
    if (r.period_status === 'draft' || r.period_status === 'for_review') { awaiting += net; continue; }
    const finished = r.period_status === 'paid' || r.period_status === 'locked';
    const paidNow = r.payment_status === 'PAID' ? net : r.payment_status === 'PARTIALLY_PAID' ? Math.min(net, r.paid_amount ?? 0)
      : r.payment_status === 'FAILED' || r.payment_status === 'RETURNED' ? 0 : finished ? net : 0;
    paid += paidNow; approvedUnpaid += net - paidNow;
  }
  const remitRows = monthRowsAllRuns.filter(r => ['approved', 'paid', 'locked'].includes(r.period_status));
  const rt = totals(remitRows);
  const cash = {
    paid: round2(paid), approved_unpaid: round2(approvedUnpaid), awaiting_approval: round2(awaiting), total: round2(paid + approvedUnpaid + awaiting),
    contributions_to_remit: round2(rt.sssEe + rt.phEe + rt.pagibigEe + rt.employer), runs: new Set(monthRowsAllRuns.map(r => r.period_id)).size,
  };

  // ---- data checks (never silently ignored) ----
  const checks: { code: string; severity: 'ok' | 'warning' | 'error'; title: string; message: string; details: string[] }[] = [];
  const names = (rows: Row[]) => [...new Set(rows.map(r => `${r.employee_name_snapshot} (${r.label})`))];
  const badNet = monthRows.filter(r => netMismatch(r));
  checks.push(badNet.length
    ? { code: 'net_mismatch', severity: 'error', title: 'Gross − Deductions ≠ Net', message: `${badNet.length} payroll record${badNet.length === 1 ? '' : 's'} where Gross − Deductions does not equal Net Pay.`, details: names(badNet) }
    : { code: 'net_mismatch', severity: 'ok', title: 'Gross − Deductions = Net', message: 'Every payroll record balances.', details: [] });
  const badGross = monthRows.filter(r => Math.abs(round2(r.basic_pay + r.ot_pay + r.allowance_pay + r.bonus_earnings) - round2(r.gross_pay)) > 0.01);
  checks.push(badGross.length
    ? { code: 'gross_parts', severity: 'error', title: 'Earnings lines ≠ Gross Pay', message: `${badGross.length} record${badGross.length === 1 ? '' : 's'} where Basic + Overtime + Allowance + Bonus does not equal Gross Pay.`, details: names(badGross) }
    : { code: 'gross_parts', severity: 'ok', title: 'Earnings lines = Gross Pay', message: 'Basic + Overtime + Allowance + Bonus matches Gross Pay on every record.', details: [] });
  const dedParts = (r: Row) => r.late_deduction + r.undertime_deduction + r.excess_break_deduction + r.absence_deduction + r.unpaid_leave_deduction + r.other_deductions + r.sss_ee_contribution + r.philhealth_ee_contribution + r.pagibig_ee_contribution;
  const badDed = monthRows.filter(r => Math.abs(round2(dedParts(r)) - round2(r.total_deductions)) > 0.01);
  checks.push(badDed.length
    ? { code: 'deduction_parts', severity: 'error', title: 'Deduction lines ≠ Total Deductions', message: `${badDed.length} record${badDed.length === 1 ? '' : 's'} where the deduction lines do not add up to Total Deductions.`, details: names(badDed) }
    : { code: 'deduction_parts', severity: 'ok', title: 'Deduction lines = Total Deductions', message: 'Deduction lines match Total Deductions on every record.', details: [] });
  const adjByEntry = new Map<number, { earn: number; ded: number }>();
  for (const a of adj) { const o = adjByEntry.get(a.payroll_entry_id) ?? { earn: 0, ded: 0 }; if (EARN.includes(a.adjustment_type)) o.earn += a.amount; else o.ded += a.amount; adjByEntry.set(a.payroll_entry_id, o); }
  const badAdj = monthRows.filter(r => { const a = adjByEntry.get(r.id) ?? { earn: 0, ded: 0 }; return Math.abs(round2(a.earn) - round2(r.bonus_earnings)) > 0.01 || Math.abs(round2(a.ded) - round2(r.other_deductions)) > 0.01; });
  checks.push(badAdj.length
    ? { code: 'adjustments', severity: 'warning', title: 'Adjustments ≠ payroll record', message: `${badAdj.length} record${badAdj.length === 1 ? '' : 's'} where manual adjustments do not match the bonus / other-deduction amounts stored on the payroll record.`, details: names(badAdj) }
    : { code: 'adjustments', severity: 'ok', title: 'Adjustments match', message: 'Bonuses and loans / cash advances agree with the manual adjustments.', details: [] });
  // The report's own arithmetic: every way of slicing the month must add back to the same totals.
  const off: string[] = [];
  const near = (a: number, b: number) => Math.abs(a - b) <= 0.02;
  if (!near(sumOf(employeeRows, e => e.gross), t.gross)) off.push(`Employees gross ${sumOf(employeeRows, e => e.gross)} vs ${t.gross}`);
  if (!near(sumOf(employeeRows, e => e.net), t.net)) off.push(`Employees net ${sumOf(employeeRows, e => e.net)} vs ${t.net}`);
  if (!near(sumOf(employeeRows, e => e.total_cost), t.expense)) off.push(`Employees cost ${sumOf(employeeRows, e => e.total_cost)} vs ${t.expense}`);
  if (!near(sumOf(runs, r => r.gross), t.gross)) off.push(`Runs gross ${sumOf(runs, r => r.gross)} vs ${t.gross}`);
  if (!near(sumOf(runs, r => r.net), t.net)) off.push(`Runs net ${sumOf(runs, r => r.net)} vs ${t.net}`);
  if (!near(sumOf(runs, r => r.total_expense), t.expense)) off.push(`Runs expense ${sumOf(runs, r => r.total_expense)} vs ${t.expense}`);
  if (!near(sumOf(departments, d => d.total_expense), t.expense)) off.push(`Departments ${sumOf(departments, d => d.total_expense)} vs ${t.expense}`);
  if (!near(round2(t.gross + t.employer), t.expense)) off.push('Gross + employer ≠ total expense');
  checks.push(off.length
    ? { code: 'crossfoot', severity: 'error', title: 'Report totals do not agree', message: 'The employee, payroll-run and department totals do not add up to the monthly total.', details: off }
    : { code: 'crossfoot', severity: 'ok', title: 'Totals cross-check', message: 'Employees, payroll runs and departments all add up to the monthly total.', details: [] });

  // ---- notes the owner should read ----
  const notes: { code: string; severity: 'info' | 'warning'; message: string }[] = [];
  if (monthRows.length > 0 && t.employer === 0) {
    notes.push({ code: 'no_employer_contributions', severity: 'warning', message: 'No employer contributions are recorded in these payroll runs (SSS, PhilHealth and Pag-IBIG were not computed), so Total Payroll Expense is understated by the employer share. Set up the government contributions on each employee.' });
  } else if (monthRows.length > 0) {
    const none = employeeRows.filter(e => e.employer === 0);
    if (none.length) notes.push({ code: 'some_no_employer', severity: 'warning', message: `${none.length} employee${none.length === 1 ? ' has' : 's have'} no employer contributions recorded: ${none.slice(0, 5).map(e => e.name).join(', ')}${none.length > 5 ? '…' : ''}.` });
  }
  if (departments.some(d => d.department === 'Unassigned') && monthRows.length > 0) notes.push({ code: 'unassigned', severity: 'info', message: 'Some employees have no department set, so they appear under “Unassigned”.' });
  if (basis !== 'all' && monthRowsAllRuns.length > monthRows.length) {
    const hidden = new Set(monthRowsAllRuns.filter(r => !BASIS_STATUSES[basis].includes(r.period_status)).map(r => r.period_id)).size;
    if (hidden) notes.push({ code: 'excluded_runs', severity: 'info', message: `${hidden} payroll run${hidden === 1 ? '' : 's'} in this month ${hidden === 1 ? 'is' : 'are'} not included because of the “${BASIS_LABEL[basis]}” basis.` });
  }

  // ---- filter options ----
  const monthsSeen = new Set<string>([month, today.slice(0, 7)]);
  for (const r of db.prepare(`SELECT to_date, pay_date FROM payroll_periods WHERE voided_at IS NULL`).all() as { to_date: string; pay_date: string | null }[]) {
    monthsSeen.add((groupBy === 'pay_date' ? (r.pay_date || r.to_date) : r.to_date).slice(0, 7));
  }
  const deptOptions = new Map<string, string>();
  for (const r of all) deptOptions.set(filterKey(r.department_snapshot), deptLabel(r.department_snapshot));

  return {
    month, label: monthLabel(month), month_start: `${month}-01`, month_end: end,
    basis, basis_label: BASIS_LABEL[basis], group_by: groupBy, schedule, department: deptFilter ? deptLabel(opts.department) : null,
    partial: { is_partial: isPartial && !isFuture, is_future: isFuture, through: isPartial && !isFuture ? today : null,
      note: isFuture ? 'This month has not started yet.' : isPartial ? `Month-to-date — data through ${fmtLongDate(today)}. Later payroll runs for this month are not in yet.` : null },
    options: {
      months: [...monthsSeen].sort().reverse().map(m => ({ value: m, label: monthLabel(m) })),
      departments: [...deptOptions.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([k, v]) => ({ value: v, key: k, label: v })),
      schedules: ['A', 'B'],
    },
    summary: {
      total_expense: t.expense, net_salaries: t.net, gross_pay: t.gross, overtime_cost: t.overtime, allowances_bonuses: round2(t.allowance + t.bonus),
      employer_contributions: t.employer, employees, avg_cost_per_employee: employees > 0 ? round2(t.expense / employees) : 0, runs: runs.length,
    },
    breakdown, comparison, trend, departments, employees: employeeRows, runs, overtime, allowances, cash, checks, notes,
  };
}
