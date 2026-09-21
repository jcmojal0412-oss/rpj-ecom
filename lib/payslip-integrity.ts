// The one place that decides whether a payroll row's totals agree with each
// other (Gross − Deductions = Net, to the centavo). It only READS the stored
// figures — nothing is recomputed or corrected. Used by the monitor (flag for
// HR), by release / email / generate (refuse to send an inconsistent payslip),
// and by the payslip page (warning banner for HR).
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function netMismatch(e: { gross_pay: number; total_deductions: number; net_pay: number }): { expected: number } | null {
  const expected = round2(e.gross_pay - e.total_deductions);
  return Math.abs(expected - round2(e.net_pay)) > 0.01 ? { expected } : null;
}

export const NET_MISMATCH_REASON = 'Totals do not add up (Gross − Deductions ≠ Net) — correct the payroll first';
