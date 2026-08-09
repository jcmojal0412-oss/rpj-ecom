// Pure statutory-contribution calculation engine — SSS, PhilHealth,
// Pag-IBIG. Same principle as lib/payroll.ts: no DB access here. Rate/
// bracket data is fetched by the DB-touching layer (the
// computeStatutoryContributionsForPeriod aggregator in lib/payroll-data.ts)
// and passed in already-resolved, so a future official rate change only
// ever requires a new version row in lib/db.ts, never a code change here.
//
// Compensation basis: all three programs are computed off the employee's
// full-period Monthly Basic Salary equivalent — NEVER reduced for late/
// undertime/absence/unpaid leave (the official PhilHealth contribution-
// basis rule; this app applies the same unreduced basis to SSS/Pag-IBIG
// for consistency — see computeContributionBasis in lib/payroll-data.ts
// for exactly how that figure is derived, and the judgment-call note
// there). Withholding tax is explicitly out of scope for V1.
//
// Every function here returns MONTHLY amounts (the officially-defined
// unit for all three programs) — splitting a monthly amount across a
// semi-monthly payroll's two cutoffs is a scheduling decision made one
// level up, in lib/payroll-data.ts, not here.

export interface SssBracket {
  minCompensation: number;
  maxCompensation: number | null; // null = no upper bound (top bracket)
  msc: number;
  eeAmount: number;
  erAmount: number;
  ecAmount: number;
}

export interface SssResult {
  msc: number;
  employeeContribution: number;
  employerContribution: number;
  ecContribution: number;
}

export function computeSssContribution(monthlyCompensation: number, brackets: SssBracket[]): SssResult {
  if (brackets.length === 0 || monthlyCompensation <= 0) {
    return { msc: 0, employeeContribution: 0, employerContribution: 0, ecContribution: 0 };
  }
  const sorted = [...brackets].sort((a, b) => a.minCompensation - b.minCompensation);
  const bracket =
    sorted.find(b => monthlyCompensation >= b.minCompensation && (b.maxCompensation === null || monthlyCompensation <= b.maxCompensation)) ??
    sorted[sorted.length - 1]; // above the top bracket's stated range — treat as the max MSC bracket
  return {
    msc: bracket.msc,
    employeeContribution: bracket.eeAmount,
    employerContribution: bracket.erAmount,
    ecContribution: bracket.ecAmount,
  };
}

export interface PhilHealthConfig {
  premiumRate: number;   // e.g. 0.05 for 5%
  incomeFloor: number;   // e.g. 10000
  incomeCeiling: number; // e.g. 100000
}

export interface PhilHealthResult {
  employeeContribution: number;
  employerContribution: number;
}

export function computePhilHealthContribution(monthlyBasicSalary: number, config: PhilHealthConfig): PhilHealthResult {
  if (monthlyBasicSalary <= 0) return { employeeContribution: 0, employerContribution: 0 };
  const base = Math.min(Math.max(monthlyBasicSalary, config.incomeFloor), config.incomeCeiling);
  const monthlyPremium = base * config.premiumRate;
  const share = round2(monthlyPremium / 2); // 50/50 EE/ER split
  return { employeeContribution: share, employerContribution: share };
}

export interface PagibigConfig {
  eeRateLow: number;     // e.g. 0.01, applies at/below eeLowThreshold
  eeRateHigh: number;    // e.g. 0.02, applies above eeLowThreshold
  eeLowThreshold: number; // e.g. 1500
  erRate: number;        // e.g. 0.02, always
  maxFundSalary: number; // e.g. 10000 — contribution base is capped here
}

export interface PagibigResult {
  employeeContribution: number;
  employerContribution: number;
}

export function computePagibigContribution(monthlyCompensation: number, config: PagibigConfig): PagibigResult {
  if (monthlyCompensation <= 0) return { employeeContribution: 0, employerContribution: 0 };
  const fundSalary = Math.min(monthlyCompensation, config.maxFundSalary);
  const eeRate = monthlyCompensation <= config.eeLowThreshold ? config.eeRateLow : config.eeRateHigh;
  return {
    employeeContribution: round2(fundSalary * eeRate),
    employerContribution: round2(fundSalary * config.erRate),
  };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
