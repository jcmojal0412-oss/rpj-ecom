// Pure payroll calculation engine — no DB access here, exactly the same
// principle as lib/attendance.ts. Every function takes already-resolved
// numbers (rate, attendance totals, approved OT, adjustments) and returns
// a computed breakdown; nothing here ever queries employees, attendance
// events, or leave requests. The DB-touching aggregation that builds the
// PayrollInput lives in lib/payroll-data.ts.
//
// Judgment calls made explicit here (documented, not hidden):
// - Basic Pay is the FULL period entitlement (what the employee would earn
//   working every scheduled day) — Late/Undertime/Absence/Unpaid Leave/
//   Excess Break are separate DEDUCTION line items subtracted afterward,
//   never baked into a reduced Basic Pay. This matches the requested
//   earnings/deductions structure and keeps the breakdown easy to explain
//   to a non-technical HR user ("here's what you'd earn, here's what got
//   deducted and why").
// - A "day" rate for per-minute deductions/OT assumes an 8-hour (480
//   minute) standard workday — a common simple default; not tied to each
//   shift template's actual span, which would vary the peso value of a
//   late-minute by which shift someone's on for no real reason.
// - Monthly-salaried Basic Pay = basic_rate / 2 per cutoff (semi-monthly),
//   matching the two default cutoffs (1-15, 16-End). Its per-day-rate
//   equivalent (used only for absence/unpaid-leave whole-day deductions)
//   is derived from workDaysInPeriod, so it adapts to each employee's own
//   configured work week rather than assuming a fixed days-per-month
//   divisor.
// - OT multiplier defaults to 1.25x (ordinary overtime), admin-configurable
//   via the payroll_ot_multiplier app_settings key — never hardcoded
//   inside a component.

export const STANDARD_MINUTES_PER_DAY = 480; // 8-hour reference workday

export type AdjustmentType =
  | 'bonus' | 'incentive' | 'additional_allowance' | 'other_earning'
  | 'cash_advance' | 'loan_deduction' | 'other_deduction';

export const EARNING_ADJUSTMENT_TYPES: AdjustmentType[] = ['bonus', 'incentive', 'additional_allowance', 'other_earning'];
export const DEDUCTION_ADJUSTMENT_TYPES: AdjustmentType[] = ['cash_advance', 'loan_deduction', 'other_deduction'];

export function isEarningAdjustment(type: AdjustmentType): boolean {
  return (EARNING_ADJUSTMENT_TYPES as string[]).includes(type);
}

export interface PayrollAdjustmentInput {
  type: AdjustmentType;
  amount: number;
}

export interface PayrollInput {
  salaryType: 'Monthly' | 'Daily';
  basicRate: number;         // monthly salary if Monthly, per-day rate if Daily
  allowance: number;
  workDaysInPeriod: number;  // employee's configured work days actually falling in this period (rest days/non-working holidays excluded)
  lateMinutes: number;
  undertimeMinutes: number;
  excessBreakMinutes: number;
  absenceDays: number;       // whole unexplained-absence days (no exception applied)
  unpaidLeaveDays: number;   // whole days on an unpaid-type approved leave (or unpaid official business)
  approvedOtMinutes: number; // ONLY approved_minutes from approved OT requests — pending/rejected never reach here
  otMultiplier: number;
  adjustments: PayrollAdjustmentInput[];
  // Statutory Contributions V1 — already-computed EE/ER amounts for THIS
  // cutoff (bracket lookup / percentage math happens one level up, in
  // computeStatutoryContributionsForPeriod() in lib/payroll-data.ts, which
  // is DB-touching; this engine stays pure). Employee shares reduce Net
  // Pay; employer shares (+ SSS EC) never do — see employerContributionsTotal.
  sssEmployeeContribution: number;
  sssEmployerContribution: number;
  sssEcContribution: number;
  philhealthEmployeeContribution: number;
  philhealthEmployerContribution: number;
  pagibigEmployeeContribution: number;
  pagibigEmployerContribution: number;
}

export interface PayrollBreakdown {
  dailyRate: number;
  perMinuteRate: number;
  basicPay: number;
  otPay: number;
  allowancePay: number;
  bonusEarnings: number;
  grossPay: number;
  lateDeduction: number;
  undertimeDeduction: number;
  excessBreakDeduction: number;
  absenceDeduction: number;
  unpaidLeaveDeduction: number;
  otherDeductions: number;
  sssEmployeeContribution: number;
  philhealthEmployeeContribution: number;
  pagibigEmployeeContribution: number;
  totalDeductions: number;
  netPay: number;
  // Company cost only — informational, already excluded from totalDeductions/netPay above.
  sssEmployerContribution: number;
  sssEcContribution: number;
  philhealthEmployerContribution: number;
  pagibigEmployerContribution: number;
  employerContributionsTotal: number;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function computePayroll(input: PayrollInput): PayrollBreakdown {
  const dailyRate = input.salaryType === 'Daily'
    ? input.basicRate
    : (input.workDaysInPeriod > 0 ? (input.basicRate / 2) / input.workDaysInPeriod : 0);
  const perMinuteRate = dailyRate / STANDARD_MINUTES_PER_DAY;

  const basicPay = input.salaryType === 'Daily'
    ? dailyRate * input.workDaysInPeriod
    : input.basicRate / 2;

  const otPay = input.approvedOtMinutes * perMinuteRate * input.otMultiplier;
  const allowancePay = input.allowance;

  const bonusEarnings = input.adjustments
    .filter(a => isEarningAdjustment(a.type))
    .reduce((sum, a) => sum + a.amount, 0);
  const otherDeductions = input.adjustments
    .filter(a => !isEarningAdjustment(a.type))
    .reduce((sum, a) => sum + a.amount, 0);

  const grossPay = basicPay + otPay + allowancePay + bonusEarnings;

  const lateDeduction = input.lateMinutes * perMinuteRate;
  const undertimeDeduction = input.undertimeMinutes * perMinuteRate;
  const excessBreakDeduction = input.excessBreakMinutes * perMinuteRate;
  const absenceDeduction = input.absenceDays * dailyRate;
  const unpaidLeaveDeduction = input.unpaidLeaveDays * dailyRate;

  const statutoryEmployeeDeductions = input.sssEmployeeContribution + input.philhealthEmployeeContribution + input.pagibigEmployeeContribution;
  const totalDeductions = lateDeduction + undertimeDeduction + excessBreakDeduction + absenceDeduction + unpaidLeaveDeduction + otherDeductions + statutoryEmployeeDeductions;
  const netPay = grossPay - totalDeductions;

  const employerContributionsTotal = input.sssEmployerContribution + input.sssEcContribution + input.philhealthEmployerContribution + input.pagibigEmployerContribution;

  return {
    dailyRate: round2(dailyRate),
    perMinuteRate: round2(perMinuteRate),
    basicPay: round2(basicPay),
    otPay: round2(otPay),
    allowancePay: round2(allowancePay),
    bonusEarnings: round2(bonusEarnings),
    grossPay: round2(grossPay),
    lateDeduction: round2(lateDeduction),
    undertimeDeduction: round2(undertimeDeduction),
    excessBreakDeduction: round2(excessBreakDeduction),
    absenceDeduction: round2(absenceDeduction),
    unpaidLeaveDeduction: round2(unpaidLeaveDeduction),
    otherDeductions: round2(otherDeductions),
    sssEmployeeContribution: round2(input.sssEmployeeContribution),
    philhealthEmployeeContribution: round2(input.philhealthEmployeeContribution),
    pagibigEmployeeContribution: round2(input.pagibigEmployeeContribution),
    totalDeductions: round2(totalDeductions),
    netPay: round2(netPay),
    sssEmployerContribution: round2(input.sssEmployerContribution),
    sssEcContribution: round2(input.sssEcContribution),
    philhealthEmployerContribution: round2(input.philhealthEmployerContribution),
    pagibigEmployerContribution: round2(input.pagibigEmployerContribution),
    employerContributionsTotal: round2(employerContributionsTotal),
  };
}

export interface PayrollCutoff {
  from: string;
  to: string;
  label: string;
  payDate: string; // same as `to` — cutoff ends the day it pays
}

// Default semi-monthly cutoffs — "1-15" and "16-End of Month". (Previously
// tried a 4x-monthly schedule — 1-8/9-15/16-23/24-end — but that's on hold
// per owner request; reverted back to 2x/month. The array-shaped return and
// the "cutoff must have already ended" disabled-state in PayrollClient's
// StepSelectPeriod both carry over unchanged, since neither is specific to
// the cutoff count.) Pure date math, no DB.
export function getDefaultCutoffs(year: number, month1to12: number): { cutoffs: PayrollCutoff[] } {
  const mm = String(month1to12).padStart(2, '0');
  const lastDay = new Date(year, month1to12, 0).getDate();
  const monthName = new Date(year, month1to12 - 1, 1).toLocaleString('en-US', { month: 'long' });
  const d = (day: number) => `${year}-${mm}-${String(day).padStart(2, '0')}`;
  const ranges: [number, number][] = [[1, 15], [16, lastDay]];
  return {
    cutoffs: ranges.map(([from, to]) => ({
      from: d(from),
      to: d(to),
      label: `${monthName} ${from}-${to}, ${year}`,
      payDate: d(to),
    })),
  };
}
