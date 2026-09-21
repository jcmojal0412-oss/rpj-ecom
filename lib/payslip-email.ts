// Builds the HTML email for "Send to Employee". It draws the same figures the
// on-screen payslip shows, straight from the stored payroll_entries snapshot
// (never recomputed), using inline-styled tables because email clients ignore
// most CSS. Every value that came from the database is HTML-escaped.

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const peso = (n: number) => `₱${(Number(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (iso: string | null) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-PH', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' });
};

const EARNING_TYPES = ['bonus', 'incentive', 'additional_allowance', 'other_earning'];
const EARNING_LABELS: Record<string, string> = { bonus: 'Bonus', incentive: 'Incentive', additional_allowance: 'Additional Allowance', other_earning: 'Salary Adjustment' };
const DEDUCTION_LABELS: Record<string, string> = { cash_advance: 'Cash Advance', loan_deduction: 'Salary Deduction', other_deduction: 'Other Deductions' };

interface Adjustment { adjustment_type: string; amount: number; reason: string }

const row = (label: string, amount: string, bold = false) =>
  `<tr><td style="padding:7px 0;border-bottom:1px solid #eef0f2;color:${bold ? '#24262a' : '#5c6066'};font-weight:${bold ? 700 : 400}">${label}</td>` +
  `<td style="padding:7px 0;border-bottom:1px solid #eef0f2;text-align:right;color:#24262a;font-weight:${bold ? 700 : 600};white-space:nowrap">${amount}</td></tr>`;

export function buildPayslipEmail(entry: Record<string, any>, adjustments: Adjustment[], period: { label: string; from_date: string; to_date: string; pay_date: string | null }) {
  const earnings = adjustments.filter(a => EARNING_TYPES.includes(a.adjustment_type));
  const manualDeductions = adjustments.filter(a => !EARNING_TYPES.includes(a.adjustment_type));
  const isDaily = entry.salary_type_snapshot === 'Daily';
  const absenceAmount = (entry.absence_deduction || 0) + (entry.unpaid_leave_deduction || 0);

  const earningRows = [
    row(isDaily ? 'Scheduled Basic Pay' : 'Basic Pay', peso(entry.basic_pay)),
    entry.ot_pay > 0 ? row('Overtime', peso(entry.ot_pay)) : '',
    entry.allowance_pay > 0 ? row('Allowance', peso(entry.allowance_pay)) : '',
    ...earnings.map(a => row(`${esc(EARNING_LABELS[a.adjustment_type])} — ${esc(a.reason)}`, peso(a.amount))),
    row('Total Earnings', peso(entry.gross_pay), true),
  ].join('');

  const deductionRows = [
    row('SSS', peso(entry.sss_ee_contribution)),
    row('PhilHealth', peso(entry.philhealth_ee_contribution)),
    row('Pag-IBIG', peso(entry.pagibig_ee_contribution)),
    entry.late_deduction > 0 ? row(`Late (${esc(entry.late_minutes)} mins)`, peso(entry.late_deduction)) : '',
    entry.undertime_deduction > 0 ? row(`Undertime (${esc(entry.undertime_minutes)} mins)`, peso(entry.undertime_deduction)) : '',
    absenceAmount > 0 ? row('Absence / Unpaid Leave', peso(absenceAmount)) : '',
    entry.excess_break_deduction > 0 ? row('Excess Break', peso(entry.excess_break_deduction)) : '',
    ...manualDeductions.map(a => row(`${esc(DEDUCTION_LABELS[a.adjustment_type])} — ${esc(a.reason)}`, peso(a.amount))),
    row('Total Deductions', peso(entry.total_deductions), true),
  ].join('');

  const period_text = `${esc(fmtDate(period.from_date))} – ${esc(fmtDate(period.to_date))}`;
  const subject = `Your payslip — ${period.label}`;
  const html = `<!doctype html><html><body style="margin:0;background:#f3f4f6;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#24262a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:10px;overflow:hidden">
<tr><td style="padding:22px 26px;border-bottom:3px solid #24262a">
  <div style="font-size:17px;font-weight:700">RPJ Trading Corporation</div>
  <div style="font-size:12px;color:#5c6066;margin-top:3px">Payslip · ${esc(period.label)}</div>
</td></tr>
<tr><td style="padding:20px 26px 6px">
  <p style="margin:0 0 12px;font-size:14px">Hello ${esc(entry.employee_name_snapshot)},</p>
  <p style="margin:0 0 16px;font-size:13px;color:#5c6066">Here is your payslip for <b>${period_text}</b>${period.pay_date ? `, paid on <b>${esc(fmtDate(period.pay_date))}</b>` : ''}.</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:12px;background:#eef0f2;border-radius:6px;margin-bottom:18px"><tr>
    <td style="padding:10px 14px"><span style="color:#8d9198;font-size:10px;text-transform:uppercase;letter-spacing:.8px">Employee ID</span><br><b>${esc(entry.employee_code_snapshot)}</b></td>
    <td style="padding:10px 14px"><span style="color:#8d9198;font-size:10px;text-transform:uppercase;letter-spacing:.8px">Position</span><br><b>${esc(entry.position_snapshot || '—')}</b></td>
    <td style="padding:10px 14px"><span style="color:#8d9198;font-size:10px;text-transform:uppercase;letter-spacing:.8px">Salary Type</span><br><b>${esc(entry.salary_type_snapshot)}</b></td>
  </tr></table>
  <div style="font-size:11px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#5b5f66;margin:4px 0 2px">Earnings</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;margin-bottom:16px">${earningRows}</table>
  <div style="font-size:11px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#7a5a17;margin:4px 0 2px">Deductions</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;margin-bottom:18px">${deductionRows}</table>
</td></tr>
<tr><td style="padding:0 26px 22px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#202226;border-radius:8px"><tr>
  <td style="padding:16px 20px;color:#cdd0d4;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase">Net Pay</td>
  <td style="padding:16px 20px;text-align:right;color:#d9ad42;font-size:24px;font-weight:700">${peso(entry.net_pay)}</td>
</tr></table></td></tr>
<tr><td style="padding:0 26px 22px;font-size:11px;color:#8d9198;line-height:1.6">This payslip is computer-generated and reflects the payroll record as approved. It is confidential and meant only for you. For questions, please contact HR.</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, html };
}

export const isValidEmail = (v: unknown): v is string => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());

// Optional copy of every payslip email (PAYSLIP_BCC_EMAIL, one or more
// addresses separated by commas) so the company keeps its own proof of sending.
export function payslipCopyRecipients(): string[] {
  return (process.env.PAYSLIP_BCC_EMAIL || '').split(/[,;\s]+/).map(x => x.trim()).filter(x => x && isValidEmail(x));
}
