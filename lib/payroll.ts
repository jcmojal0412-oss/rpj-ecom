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
export const LATE_ROUNDING_BLOCK_MINUTES = 30;

// Late is billed in 30-minute blocks, rounded UP — 1 minute late costs the
// same as 30, 31 minutes costs the same as 60, and so on. Requested
// explicitly by the owner (a discipline-oriented policy, not a plain
// proportional "pay for exactly the minutes missed" deduction). Undertime
// and Excess Break are NOT rounded this way — only Late — since the request
// was scoped to Late specifically. 0 minutes late stays 0 (never rounds up
// to a full block).
export function roundLateMinutesToBlock(lateMinutes: number): number {
  if (lateMinutes <= 0) return 0;
  return Math.ceil(lateMinutes / LATE_ROUNDING_BLOCK_MINUTES) * LATE_ROUNDING_BLOCK_MINUTES;
}

export const OT_ROUNDING_BLOCK_MINUTES = 30;

// OT is billed in 30-minute blocks too, but rounded DOWN — the opposite
// direction from Late. A completed 30-min block gets paid in full; a
// partial one (1-29 minutes into the next block) pays nothing for that
// partial stretch. Matches HR's stated rule: "30 minute consider as 30
// minute OT, less than 30 minutes wala pong OT" — separately, requests
// under attendance_min_minutes_before_ot (also 30 by default) never even
// get flagged as OT at all (see flagPotentialOvertime in
// lib/attendance-jobs.ts); this floor is what additionally trims a
// larger-but-not-block-aligned approval (e.g. 47 approved minutes bills as
// only 30, not 47) at the payroll math step.
export function roundOtMinutesToBlock(otMinutes: number): number {
  if (otMinutes <= 0) return 0;
  return Math.floor(otMinutes / OT_ROUNDING_BLOCK_MINUTES) * OT_ROUNDING_BLOCK_MINUTES;
}

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

  const otPay = roundOtMinutesToBlock(input.approvedOtMinutes) * perMinuteRate * input.otMultiplier;
  const allowancePay = input.allowance;

  const bonusEarnings = input.adjustments
    .filter(a => isEarningAdjustment(a.type))
    .reduce((sum, a) => sum + a.amount, 0);
  const otherDeductions = input.adjustments
    .filter(a => !isEarningAdjustment(a.type))
    .reduce((sum, a) => sum + a.amount, 0);

  const grossPay = basicPay + otPay + allowancePay + bonusEarnings;

  const lateDeduction = roundLateMinutesToBlock(input.lateMinutes) * perMinuteRate;
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
  payDate: string; // NOT necessarily `to` — see getScheduleCutoffs below, paydate can lag the cutoff's end by several days.
}

export type PayrollScheduleId = 'A' | 'B';

export const PAYROLL_SCHEDULE_LABELS: Record<PayrollScheduleId, string> = {
  A: 'Schedule A',
  B: 'Schedule B',
};

function clampDay(year: number, month1to12: number, day: number): number {
  return Math.min(day, new Date(year, month1to12, 0).getDate()); // e.g. day 30 in Feb -> 28/29
}
function ymd(year: number, month1to12: number, day: number): string {
  return `${year}-${String(month1to12).padStart(2, '0')}-${String(clampDay(year, month1to12, day)).padStart(2, '0')}`;
}
function shiftMonth(year: number, month1to12: number, delta: number): [number, number] {
  let m = month1to12 + delta, y = year;
  while (m > 12) { m -= 12; y++; }
  while (m < 1) { m += 12; y--; }
  return [y, m];
}
function monthName(year: number, month1to12: number): string {
  return new Date(year, month1to12 - 1, 1).toLocaleString('en-US', { month: 'long' });
}

// Two named, per-employee-assignable cutoff schedules (employees.payroll_schedule),
// replacing the old single company-wide "1-15 / 16-End, paid same day" schedule.
// Both are still semi-monthly, but with different day boundaries AND a real lag
// between a cutoff's end and its payday — set per the owner's actual payroll rules:
//   Schedule A: cutoff 21-5 -> pay 15th   |  cutoff 6-20  -> pay 30th
//   Schedule B: cutoff 16-30 -> pay 8th   |  cutoff 1-15  -> pay 23rd
// `month1to12` anchors by PAYDATE month — both of a schedule's cutoffs for a given
// month pay out within that same displayed month, even though a cutoff's own start
// (Schedule A's 21st, Schedule B's 16th) falls in the prior calendar month.
export function getScheduleCutoffs(schedule: PayrollScheduleId, year: number, month1to12: number): { cutoffs: PayrollCutoff[] } {
  const mName = monthName(year, month1to12);
  const [py, pm] = shiftMonth(year, month1to12, -1);
  const pName = monthName(py, pm);

  if (schedule === 'A') {
    return {
      cutoffs: [
        {
          from: ymd(py, pm, 21), to: ymd(year, month1to12, 5),
          label: `${pName} 21 – ${mName} 5, ${year} (Schedule A)`,
          payDate: ymd(year, month1to12, 15),
        },
        {
          from: ymd(year, month1to12, 6), to: ymd(year, month1to12, 20),
          label: `${mName} 6-20, ${year} (Schedule A)`,
          payDate: ymd(year, month1to12, 30),
        },
      ],
    };
  }

  const lastDayPrev = new Date(py, pm, 0).getDate();
  return {
    cutoffs: [
      {
        from: ymd(py, pm, 16), to: ymd(py, pm, lastDayPrev),
        label: `${pName} 16-${lastDayPrev}, ${py} (Schedule B)`,
        payDate: ymd(year, month1to12, 8),
      },
      {
        from: ymd(year, month1to12, 1), to: ymd(year, month1to12, 15),
        label: `${mName} 1-15, ${year} (Schedule B)`,
        payDate: ymd(year, month1to12, 23),
      },
    ],
  };
}
