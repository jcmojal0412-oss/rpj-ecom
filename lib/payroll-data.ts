// DB-touching aggregation layer for Payroll V1 — turns a raw date range +
// employee into the numbers lib/payroll.ts's pure computePayroll() needs.
// Reuses the exact same building blocks records/route.ts already uses
// (resolveAttendanceSettings, computeDaySummary, resolveAttendanceException,
// applyAttendanceException) rather than re-deriving attendance logic here.
import type Database from 'better-sqlite3';
import { computeDaySummary, isTodayFinalized, todayISO, type AttendanceEvent } from './attendance';
import { resolveAttendanceSettings } from './attendance-shifts';
import { resolveAttendanceException, applyAttendanceException } from './attendance-exceptions';
import { computePayroll, type PayrollInput, type AdjustmentType } from './payroll';
import {
  computeSssContribution, computePhilHealthContribution, computePagibigContribution,
  type SssBracket, type PhilHealthConfig, type PagibigConfig,
} from './statutory-contributions';

export interface PayrollEmployee {
  id: number;
  full_name: string;
  work_days: string;
  rest_day: number | null;
  salary_type: 'Monthly' | 'Daily';
  basic_rate: number;
  allowance: number;
  ot_eligible: number;
  sss_enabled: number;
  philhealth_enabled: number;
  pagibig_enabled: number;
}

export interface AttendanceAggregate {
  workDaysInPeriod: number;
  lateMinutes: number;
  undertimeMinutes: number;
  excessBreakMinutes: number;
  absenceDays: number;
  unpaidLeaveDays: number;
}

// See the identical helper in app/api/attendance/records/route.ts for why
// this uses Date.UTC() explicitly rather than `new Date(dateStr +
// 'T00:00:00')` — the latter is silently timezone-sensitive.
function dateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  let cur = Date.UTC(fy, fm - 1, fd);
  const end = Date.UTC(ty, tm - 1, td);
  while (cur <= end) {
    dates.push(new Date(cur).toISOString().slice(0, 10));
    cur += 86_400_000;
  }
  return dates;
}

// Days that don't count toward the employee's pay expectation at all —
// rest days and non-working holidays are excluded from workDaysInPeriod
// entirely (same treatment as each other), matching "Rest Days must not
// create absence deduction" and "Non-working holidays must follow
// configured attendance/holiday rules."
function isExcludedFromPeriod(exceptionStatus: string | undefined): boolean {
  return exceptionStatus === 'rest_day' || exceptionStatus === 'holiday';
}

export function aggregateAttendanceForPeriod(db: Database.Database, employee: PayrollEmployee, fromDate: string, toDate: string): AttendanceAggregate {
  const today = todayISO();
  const dates = dateRange(fromDate, toDate);

  const eventsByDate = new Map<string, AttendanceEvent[]>();
  const eventsRawWithDate = db.prepare(`
    SELECT id, event_date, event_type, event_time, superseded_by FROM attendance_events
    WHERE employee_id = ? AND event_date BETWEEN ? AND ? AND is_test = 0
    ORDER BY event_time ASC
  `).all(employee.id, fromDate, toDate) as (AttendanceEvent & { event_date: string })[];
  for (const e of eventsRawWithDate) {
    if (!eventsByDate.has(e.event_date)) eventsByDate.set(e.event_date, []);
    eventsByDate.get(e.event_date)!.push(e);
  }

  const agg: AttendanceAggregate = {
    workDaysInPeriod: 0, lateMinutes: 0, undertimeMinutes: 0, excessBreakMinutes: 0,
    absenceDays: 0, unpaidLeaveDays: 0,
  };

  for (const date of dates) {
    const exception = resolveAttendanceException(db, employee, date);
    if (isExcludedFromPeriod(exception?.status)) continue; // rest day / non-working holiday — no pay expectation either way

    agg.workDaysInPeriod++;

    if (exception?.status === 'on_leave' || exception?.status === 'official_business') {
      if (!exception.paid) {
        // Half-day leave requests deduct half a day; everything else
        // (official business, full-day leave) deducts a whole day.
        const dayType = exception.status === 'on_leave' ? getLeaveDayType(db, employee.id, date) : 'full';
        agg.unpaidLeaveDays += dayType === 'half' ? 0.5 : 1;
      }
      continue; // paid leave/OB: no deduction, already covered by the flat Basic Pay
    }

    const resolved = resolveAttendanceSettings(db, employee.id, date);
    if (!resolved) continue; // no shift assignment covering this date — nothing to compute

    const events = eventsByDate.get(date) ?? [];
    const isFinalized = date < today || (date === today && isTodayFinalized(resolved.settings));
    const raw = computeDaySummary(events, resolved.settings, isFinalized);
    const { status } = applyAttendanceException(raw, exception);

    if (status === 'absent') {
      agg.absenceDays += 1;
    } else {
      agg.lateMinutes += raw.lateMinutes;
      agg.undertimeMinutes += raw.undertimeMinutes;
      agg.excessBreakMinutes += raw.excessBreakMinutes;
    }
  }

  return agg;
}

function getLeaveDayType(db: Database.Database, employeeId: number, date: string): 'full' | 'half' {
  const row = db.prepare(`
    SELECT day_type FROM leave_requests
    WHERE employee_id = ? AND status = 'approved' AND ? BETWEEN from_date AND to_date
    LIMIT 1
  `).get(employeeId, date) as { day_type: string } | undefined;
  return row?.day_type === 'half' ? 'half' : 'full';
}

// Approved OT only — pending requests are never summed here (they don't
// exist as approved_minutes yet), and a rejected request's approved_minutes
// is always 0, so summing "status='approved'" rows is sufficient to
// guarantee "Pending OT must NEVER be included, Rejected OT = ₱0."
export function getApprovedOtMinutes(db: Database.Database, employeeId: number, fromDate: string, toDate: string): number {
  const row = db.prepare(`
    SELECT COALESCE(SUM(approved_minutes), 0) as total FROM attendance_ot_requests
    WHERE employee_id = ? AND status = 'approved' AND event_date BETWEEN ? AND ?
  `).get(employeeId, fromDate, toDate) as { total: number };
  return row.total;
}

export interface AttendanceWarning {
  type: 'missing_time_out' | 'pending_correction' | 'pending_ot' | 'pending_leave' | 'missing_rate';
  message: string;
}

// Simple, actionable warnings for Step 2 of the wizard — informational
// only (does not block generation), always re-checked live so it reflects
// current reality even if HR revisits a draft period later.
export function checkAttendanceWarnings(db: Database.Database, employee: PayrollEmployee, fromDate: string, toDate: string): AttendanceWarning[] {
  const warnings: AttendanceWarning[] = [];

  if (!employee.basic_rate || employee.basic_rate <= 0) {
    warnings.push({ type: 'missing_rate', message: `${employee.full_name} has no salary/rate configured.` });
  }

  const missingOut = db.prepare(`
    SELECT event_date FROM attendance_events
    WHERE employee_id = ? AND event_date BETWEEN ? AND ? AND event_type = 'TIME_IN' AND superseded_by IS NULL AND is_test = 0
    AND event_date NOT IN (
      SELECT event_date FROM attendance_events
      WHERE employee_id = ? AND event_type = 'TIME_OUT' AND superseded_by IS NULL AND is_test = 0
    )
    ORDER BY event_date ASC
  `).all(employee.id, fromDate, toDate, employee.id) as { event_date: string }[];
  for (const row of missingOut) {
    warnings.push({ type: 'missing_time_out', message: `${employee.full_name} — missing Time Out on ${row.event_date}.` });
  }

  const pendingCorrections = (db.prepare(`
    SELECT COUNT(*) as c FROM attendance_corrections WHERE employee_id = ? AND status = 'pending' AND event_date BETWEEN ? AND ?
  `).get(employee.id, fromDate, toDate) as { c: number }).c;
  if (pendingCorrections > 0) {
    warnings.push({ type: 'pending_correction', message: `${employee.full_name} has ${pendingCorrections} pending attendance correction request(s).` });
  }

  const pendingOt = (db.prepare(`
    SELECT COUNT(*) as c FROM attendance_ot_requests WHERE employee_id = ? AND status = 'pending' AND event_date BETWEEN ? AND ?
  `).get(employee.id, fromDate, toDate) as { c: number }).c;
  if (pendingOt > 0) {
    warnings.push({ type: 'pending_ot', message: `${employee.full_name} has ${pendingOt} pending OT request(s) — will NOT be included until approved.` });
  }

  const pendingLeave = (db.prepare(`
    SELECT COUNT(*) as c FROM leave_requests WHERE employee_id = ? AND status = 'pending' AND from_date <= ? AND to_date >= ?
  `).get(employee.id, toDate, fromDate) as { c: number }).c;
  if (pendingLeave > 0) {
    warnings.push({ type: 'pending_leave', message: `${employee.full_name} has ${pendingLeave} pending leave request(s) overlapping this period.` });
  }

  return warnings;
}

export interface StatutoryContributions {
  contributionBasis: number;
  sssEmployee: number; sssEmployer: number; sssEc: number; sssVersion: string | null;
  philhealthEmployee: number; philhealthEmployer: number; philhealthVersion: string | null;
  pagibigEmployee: number; pagibigEmployer: number; pagibigVersion: string | null;
}

// "Monthly Basic Salary" for statutory-contribution purposes — the FULL
// scheduled entitlement, never reduced for late/undertime/absence/unpaid
// leave (the official PhilHealth contribution-basis rule; applied to
// SSS/Pag-IBIG too for consistency — a documented judgment call, flagged
// for the user's review in the acceptance report). Monthly-salaried
// employees already store a monthly figure in basic_rate. Daily-rate
// employees don't have one on file, so it's derived as this cutoff's own
// scheduled-day count (workDaysInPeriod already excludes rest days/
// holidays — see aggregateAttendanceForPeriod above) doubled for the
// semi-monthly-to-monthly conversion — an approximation that reflects each
// employee's own configured work week rather than an arbitrary fixed
// day-count constant.
export function computeContributionBasis(employee: PayrollEmployee, workDaysInPeriod: number): number {
  if (employee.salary_type === 'Monthly') return employee.basic_rate;
  return employee.basic_rate * workDaysInPeriod * 2;
}

function getActiveSssBrackets(db: Database.Database): { brackets: SssBracket[]; versionLabel: string | null } {
  const version = db.prepare(`SELECT id, version_label FROM sss_contribution_versions WHERE is_active = 1 ORDER BY effective_date DESC LIMIT 1`).get() as { id: number; version_label: string } | undefined;
  if (!version) return { brackets: [], versionLabel: null };
  const rows = db.prepare(`
    SELECT min_compensation, max_compensation, msc, ee_amount, er_amount, ec_amount
    FROM sss_contribution_brackets WHERE version_id = ? ORDER BY min_compensation ASC
  `).all(version.id) as { min_compensation: number; max_compensation: number | null; msc: number; ee_amount: number; er_amount: number; ec_amount: number }[];
  return {
    brackets: rows.map(r => ({ minCompensation: r.min_compensation, maxCompensation: r.max_compensation, msc: r.msc, eeAmount: r.ee_amount, erAmount: r.er_amount, ecAmount: r.ec_amount })),
    versionLabel: version.version_label,
  };
}

function getActivePhilHealthConfig(db: Database.Database): { config: PhilHealthConfig | null; versionLabel: string | null } {
  const row = db.prepare(`
    SELECT version_label, premium_rate, income_floor, income_ceiling FROM philhealth_contribution_versions WHERE is_active = 1 ORDER BY effective_date DESC LIMIT 1
  `).get() as { version_label: string; premium_rate: number; income_floor: number; income_ceiling: number } | undefined;
  if (!row) return { config: null, versionLabel: null };
  return { config: { premiumRate: row.premium_rate, incomeFloor: row.income_floor, incomeCeiling: row.income_ceiling }, versionLabel: row.version_label };
}

function getActivePagibigConfig(db: Database.Database): { config: PagibigConfig | null; versionLabel: string | null } {
  const row = db.prepare(`
    SELECT version_label, ee_rate_low, ee_rate_high, ee_low_threshold, er_rate, max_fund_salary FROM pagibig_contribution_versions WHERE is_active = 1 ORDER BY effective_date DESC LIMIT 1
  `).get() as { version_label: string; ee_rate_low: number; ee_rate_high: number; ee_low_threshold: number; er_rate: number; max_fund_salary: number } | undefined;
  if (!row) return { config: null, versionLabel: null };
  return { config: { eeRateLow: row.ee_rate_low, eeRateHigh: row.ee_rate_high, eeLowThreshold: row.ee_low_threshold, erRate: row.er_rate, maxFundSalary: row.max_fund_salary }, versionLabel: row.version_label };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Each program's official amount is a MONTHLY figure; this app runs
// semi-monthly payroll, so it's split evenly across the two cutoffs — the
// same simple convention as a Monthly-salaried employee's Basic Pay itself
// (basic_rate / 2 per cutoff, see lib/payroll.ts). Any program the
// employee has toggled off (employee.*_enabled = 0) contributes ₱0 on
// both sides.
export function computeStatutoryContributionsForPeriod(db: Database.Database, employee: PayrollEmployee, workDaysInPeriod: number): StatutoryContributions {
  const contributionBasis = computeContributionBasis(employee, workDaysInPeriod);

  let sssEmployee = 0, sssEmployer = 0, sssEc = 0, sssVersion: string | null = null;
  if (employee.sss_enabled) {
    const { brackets, versionLabel } = getActiveSssBrackets(db);
    const result = computeSssContribution(contributionBasis, brackets);
    sssEmployee = round2(result.employeeContribution / 2);
    sssEmployer = round2(result.employerContribution / 2);
    sssEc = round2(result.ecContribution / 2);
    sssVersion = versionLabel;
  }

  let philhealthEmployee = 0, philhealthEmployer = 0, philhealthVersion: string | null = null;
  if (employee.philhealth_enabled) {
    const { config, versionLabel } = getActivePhilHealthConfig(db);
    if (config) {
      const result = computePhilHealthContribution(contributionBasis, config);
      philhealthEmployee = round2(result.employeeContribution / 2);
      philhealthEmployer = round2(result.employerContribution / 2);
      philhealthVersion = versionLabel;
    }
  }

  let pagibigEmployee = 0, pagibigEmployer = 0, pagibigVersion: string | null = null;
  if (employee.pagibig_enabled) {
    const { config, versionLabel } = getActivePagibigConfig(db);
    if (config) {
      const result = computePagibigContribution(contributionBasis, config);
      pagibigEmployee = round2(result.employeeContribution / 2);
      pagibigEmployer = round2(result.employerContribution / 2);
      pagibigVersion = versionLabel;
    }
  }

  return {
    contributionBasis,
    sssEmployee, sssEmployer, sssEc, sssVersion,
    philhealthEmployee, philhealthEmployer, philhealthVersion,
    pagibigEmployee, pagibigEmployer, pagibigVersion,
  };
}

// Re-runs the pure engine for an existing entry using its FROZEN snapshot
// columns (salary/attendance never re-read live) plus whatever the
// adjustments table currently holds — the only thing that can change a
// generated entry's totals is adding/removing a manual adjustment.
export function recomputePayrollEntry(db: Database.Database, entryId: number): void {
  const entry = db.prepare('SELECT * FROM payroll_entries WHERE id = ?').get(entryId) as any;
  if (!entry) return;

  const adjustments = db.prepare('SELECT adjustment_type, amount FROM payroll_adjustments WHERE payroll_entry_id = ?').all(entryId) as { adjustment_type: AdjustmentType; amount: number }[];

  const input: PayrollInput = {
    salaryType: entry.salary_type_snapshot,
    basicRate: entry.basic_rate_snapshot,
    allowance: entry.allowance_snapshot,
    workDaysInPeriod: entry.work_days_count,
    lateMinutes: entry.late_minutes,
    undertimeMinutes: entry.undertime_minutes,
    excessBreakMinutes: entry.excess_break_minutes,
    absenceDays: entry.absence_days,
    unpaidLeaveDays: entry.unpaid_leave_days,
    approvedOtMinutes: entry.approved_ot_minutes,
    otMultiplier: entry.ot_multiplier_snapshot,
    adjustments: adjustments.map(a => ({ type: a.adjustment_type, amount: a.amount })),
    // Statutory contributions are based on basic salary, never on bonuses/
    // cash advances/loan deductions — so an adjustment change must NEVER
    // recompute these off live rates. Pass through the exact frozen amounts
    // already on the entry (set once, at generation time).
    sssEmployeeContribution: entry.sss_ee_contribution,
    sssEmployerContribution: entry.sss_er_contribution,
    sssEcContribution: entry.sss_ec_contribution,
    philhealthEmployeeContribution: entry.philhealth_ee_contribution,
    philhealthEmployerContribution: entry.philhealth_er_contribution,
    pagibigEmployeeContribution: entry.pagibig_ee_contribution,
    pagibigEmployerContribution: entry.pagibig_er_contribution,
  };
  const breakdown = computePayroll(input);

  db.prepare(`
    UPDATE payroll_entries SET
      basic_pay=?, ot_pay=?, allowance_pay=?, bonus_earnings=?, gross_pay=?,
      late_deduction=?, undertime_deduction=?, excess_break_deduction=?, absence_deduction=?, unpaid_leave_deduction=?,
      other_deductions=?, total_deductions=?, net_pay=?
    WHERE id=?
  `).run(
    breakdown.basicPay, breakdown.otPay, breakdown.allowancePay, breakdown.bonusEarnings, breakdown.grossPay,
    breakdown.lateDeduction, breakdown.undertimeDeduction, breakdown.excessBreakDeduction, breakdown.absenceDeduction, breakdown.unpaidLeaveDeduction,
    breakdown.otherDeductions, breakdown.totalDeductions, breakdown.netPay,
    entryId
  );
}
