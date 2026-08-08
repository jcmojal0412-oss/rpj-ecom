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
  totalDeductions: number;
  netPay: number;
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

  const totalDeductions = lateDeduction + undertimeDeduction + excessBreakDeduction + absenceDeduction + unpaidLeaveDeduction + otherDeductions;
  const netPay = grossPay - totalDeductions;

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
    totalDeductions: round2(totalDeductions),
    netPay: round2(netPay),
  };
}

// Default semi-monthly cutoffs for a given month — "1-15" and "16-End of
// Month". Pure date math, no DB.
export function getDefaultCutoffs(year: number, month1to12: number): { firstHalf: { from: string; to: string; label: string }; secondHalf: { from: string; to: string; label: string } } {
  const mm = String(month1to12).padStart(2, '0');
  const lastDay = new Date(year, month1to12, 0).getDate();
  const monthName = new Date(year, month1to12 - 1, 1).toLocaleString('en-US', { month: 'long' });
  return {
    firstHalf: { from: `${year}-${mm}-01`, to: `${year}-${mm}-15`, label: `${monthName} 1-15, ${year}` },
    secondHalf: { from: `${year}-${mm}-16`, to: `${year}-${mm}-${String(lastDay).padStart(2, '0')}`, label: `${monthName} 16-${lastDay}, ${year}` },
  };
}
