// Builds the HTML email for "Send to Employee". Two clearly separate parts:
//   1. a normal HR message (greeting, what this is, pay date, who to contact)
//   2. the payslip itself, as a bordered "document" card further down.
// The payslip figures are the stored payroll_entries snapshot (never
// recomputed) — this file only decides how they are presented. Layout is
// email-safe: nested tables, inline styles, no scripts, web-safe fonts, a 600px
// column that shrinks on phones. Every value from the database is HTML-escaped.

export const COMPANY_NAME = 'RPJ Trading Corporation';

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const peso = (n: number) => `₱${(Number(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const parts = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return { y, m, d }; };
const utc = (iso: string) => { const { y, m, d } = parts(iso); return new Date(Date.UTC(y, m - 1, d)); };
const fmtDate = (iso: string | null) => (iso ? utc(iso).toLocaleDateString('en-PH', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' }) : '');
const monthName = (iso: string) => utc(iso).toLocaleDateString('en-PH', { timeZone: 'UTC', month: 'long' });

// "September 1–15, 2026" / "August 21 – September 5, 2026" / across years in full.
export function payPeriodText(from: string, to: string): string {
  const a = parts(from), b = parts(to);
  if (a.y === b.y && a.m === b.m) return a.d === b.d ? `${monthName(from)} ${a.d}, ${a.y}` : `${monthName(from)} ${a.d}–${b.d}, ${a.y}`;
  if (a.y === b.y) return `${monthName(from)} ${a.d} – ${monthName(to)} ${b.d}, ${a.y}`;
  return `${fmtDate(from)} – ${fmtDate(to)}`;
}

// Names are stored however they were typed ("BERNALYN MANOY", "Lopez, Dina").
// The greeting uses a tidy first name; mixed-case tokens are left alone.
export function firstNameOf(full: string | null | undefined): string {
  let name = String(full ?? '').trim();
  if (name.includes(',')) name = name.split(',').slice(1).join(' ').trim() || name;
  const token = name.split(/\s+/)[0] ?? '';
  if (!token) return '';
  if (token !== token.toUpperCase() && token !== token.toLowerCase()) return token;
  return token.toLowerCase().replace(/(^|[-'])([a-z])/g, (_m, sep, ch) => sep + ch.toUpperCase());
}

const EARNING_TYPES = ['bonus', 'incentive', 'additional_allowance', 'other_earning'];
const EARNING_LABELS: Record<string, string> = { bonus: 'Bonus', incentive: 'Incentive', additional_allowance: 'Additional Allowance', other_earning: 'Salary Adjustment' };
const DEDUCTION_LABELS: Record<string, string> = { cash_advance: 'Cash Advance', loan_deduction: 'Loan / Salary Deduction', other_deduction: 'Other Deductions' };

interface Adjustment { adjustment_type: string; amount: number; reason: string }

export interface PayslipEmailOptions {
  department?: string | null;
  // Where the "View Payslip in Employee Portal" button goes. Leave out when the
  // employee has no login, and no button is shown.
  portalUrl?: string | null;
  // Working mailbox for payroll questions / attendance concerns. Only shown
  // when set, so we never print an address nobody reads.
  supportEmail?: string | null;
  hrEmail?: string | null;
  logoUrl?: string;
  year?: number;
}

const INK = '#24262a', MUTED = '#5c6066', FAINT = '#8d9198', LINE = '#e7e9ec', GOLD = '#8a6510', GOLD_SOFT = '#fbf6e8', GOLD_LINE = '#ecd9a3', PAGE = '#f2f3f5', BAND = '#f6f7f8';
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const mailto = (a: string) => `<a href="mailto:${esc(a)}" style="color:${GOLD};text-decoration:underline">${esc(a)}</a>`;

const line = (label: string, amount: string, strong = false) =>
  `<tr><td style="padding:7px 0;border-bottom:1px solid ${LINE};font-size:14px;line-height:20px;color:${strong ? INK : MUTED};font-weight:${strong ? 700 : 400}">${label}</td>` +
  `<td align="right" style="padding:7px 0 7px 12px;border-bottom:1px solid ${LINE};font-size:14px;line-height:20px;color:${INK};font-weight:${strong ? 700 : 600};white-space:nowrap">${amount}</td></tr>`;

const heading = (text: string) =>
  `<div style="padding:14px 0 2px;font-size:11px;line-height:16px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:${GOLD}">${text}</div>`;

export function buildPayslipEmail(
  entry: Record<string, any>,
  adjustments: Adjustment[],
  period: { label: string; from_date: string; to_date: string; pay_date: string | null },
  options: PayslipEmailOptions = {},
) {
  const periodText = payPeriodText(period.from_date, period.to_date);
  const payDate = period.pay_date ? fmtDate(period.pay_date) : '';
  const first = firstNameOf(entry.employee_name_snapshot);
  const isDaily = entry.salary_type_snapshot === 'Daily';
  const support = options.supportEmail && isValidEmail(options.supportEmail) ? options.supportEmail.trim() : '';
  const hr = options.hrEmail && isValidEmail(options.hrEmail) && options.hrEmail.trim().toLowerCase() !== support.toLowerCase() ? options.hrEmail.trim() : '';
  const contactEmail = support || hr;
  const logoUrl = options.logoUrl ?? 'https://rpjcorp.com/email-logo.png';
  const year = options.year ?? new Date().getFullYear();

  const earnings = adjustments.filter(a => EARNING_TYPES.includes(a.adjustment_type));
  const manualDeductions = adjustments.filter(a => !EARNING_TYPES.includes(a.adjustment_type));
  const absenceAmount = (entry.absence_deduction || 0) + (entry.unpaid_leave_deduction || 0);

  // Only lines that have a value are shown (Basic Pay stays as the anchor).
  const earningRows = [
    line(isDaily ? 'Scheduled Basic Pay' : 'Basic Pay', peso(entry.basic_pay)),
    entry.ot_pay > 0 ? line('Overtime', peso(entry.ot_pay)) : '',
    entry.allowance_pay > 0 ? line('Allowance', peso(entry.allowance_pay)) : '',
    ...earnings.map(a => line(`${esc(EARNING_LABELS[a.adjustment_type])} — ${esc(a.reason)}`, peso(a.amount))),
    line('Total Earnings', peso(entry.gross_pay), true),
  ].join('');

  const deductionLines = [
    entry.sss_ee_contribution > 0 ? line('SSS', peso(entry.sss_ee_contribution)) : '',
    entry.philhealth_ee_contribution > 0 ? line('PhilHealth', peso(entry.philhealth_ee_contribution)) : '',
    entry.pagibig_ee_contribution > 0 ? line('Pag-IBIG', peso(entry.pagibig_ee_contribution)) : '',
    entry.late_deduction > 0 ? line(`Late (${esc(entry.late_minutes)} mins)`, peso(entry.late_deduction)) : '',
    entry.undertime_deduction > 0 ? line(`Undertime (${esc(entry.undertime_minutes)} mins)`, peso(entry.undertime_deduction)) : '',
    absenceAmount > 0 ? line('Absence / Unpaid Leave', peso(absenceAmount)) : '',
    entry.excess_break_deduction > 0 ? line('Excess Break', peso(entry.excess_break_deduction)) : '',
    ...manualDeductions.map(a => line(`${esc(DEDUCTION_LABELS[a.adjustment_type] ?? 'Deduction')} — ${esc(a.reason)}`, peso(a.amount))),
  ].filter(Boolean);
  const deductionRows = (deductionLines.length ? deductionLines.join('') : line('No deductions this period', peso(0))) + line('Total Deductions', peso(entry.total_deductions), true);

  // Employee information: only what exists.
  const info: [string, string][] = ([
    ['Employee', entry.employee_name_snapshot],
    ['Employee ID', entry.employee_code_snapshot],
    ['Position', entry.position_snapshot],
    ['Department', options.department],
    ['Salary Type', entry.pay_basis_snapshot === 'fixed' ? 'Monthly · Fixed rate' : entry.salary_type_snapshot],
  ] as [string, unknown][]).filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '').map(([k, v]) => [k, String(v)]);
  const infoCell = ([k, v]: [string, string]) =>
    `<td valign="top" width="50%" style="padding:4px 8px 4px 0"><div style="font-size:11px;line-height:14px;color:${FAINT};text-transform:uppercase;letter-spacing:.8px">${esc(k)}</div>` +
    `<div style="font-size:14px;line-height:20px;color:${INK};font-weight:600;word-break:break-word">${esc(v)}</div></td>`;
  const infoRows: string[] = [];
  for (let i = 0; i < info.length; i += 2) infoRows.push(`<tr>${infoCell(info[i])}${info[i + 1] ? infoCell(info[i + 1]) : '<td width="50%"></td>'}</tr>`);

  const subject = `Your Payslip – ${periodText}`;
  const preheader = `Your payslip for ${periodText} is now available.`;

  // Earnings | Deductions side by side on wide screens. Each column is an
  // inline-block capped at COL px, so when there isn't room for two they simply
  // stack (phones) with no media query; Outlook gets a ghost table instead.
  const COL = 288, GUT = 8;
  const col = (inner: string) => `<div style="display:inline-block;width:100%;max-width:${COL}px;vertical-align:top"><div style="padding:0 ${GUT}px;font-size:14px;line-height:20px;text-align:left">${inner}</div></div>`;
  const earningsCol = col(`${heading('Earnings')}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${earningRows}</table>`);
  const deductionsCol = col(`${heading('Deductions')}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${deductionRows}</table>`);

  const button = options.portalUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto"><tr><td align="center" bgcolor="${GOLD}" style="background:${GOLD};border-radius:6px">` +
      `<a href="${esc(options.portalUrl)}" target="_blank" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:14px;line-height:18px;font-weight:700;color:#ffffff;text-decoration:none">View Payslip in Employee Portal</a></td></tr></table>`
    : '';

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="light"><title>${esc(subject)}</title>
<style>
  @media only screen and (max-width:700px){
    .pad{padding-left:20px !important;padding-right:20px !important}
    .card-pad{padding-left:16px !important;padding-right:16px !important}
    .cols{padding-left:8px !important;padding-right:8px !important}
    .net{font-size:28px !important}
  }
</style></head>
<body style="margin:0;padding:0;background:${PAGE};font-family:${FONT};color:${INK};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:${PAGE}">${esc(preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAGE}"><tr><td align="center" style="padding:24px 10px">
<table role="presentation" width="680" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:680px;background:#ffffff;border:1px solid ${LINE};border-radius:8px">

<!-- 1. Branding -->
<tr><td class="pad" style="padding:18px 32px 16px;border-bottom:3px solid ${GOLD}">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td valign="middle" style="padding-right:14px"><img src="${esc(logoUrl)}" width="76" height="70" alt="RPJ Corp." style="display:block;width:76px;height:auto;border:0;outline:none;text-decoration:none"></td>
    <td valign="middle">
      <div style="font-size:17px;line-height:22px;font-weight:700;color:${INK}">${COMPANY_NAME}</div>
      <div style="font-size:13px;line-height:18px;color:${MUTED}">HR &amp; Payroll Department</div>
      <div style="font-size:10px;line-height:16px;letter-spacing:1.4px;text-transform:uppercase;color:${GOLD};padding-top:2px">Employee Payroll Notification</div>
    </td>
  </tr></table>
</td></tr>

<!-- 2. The message from HR -->
<tr><td class="pad" style="padding:24px 32px 26px;font-size:15px;line-height:24px;color:${INK}">
  <p style="margin:0 0 14px">Hello ${esc(first) || 'there'},</p>
  <p style="margin:0 0 14px">Your payslip for <b>${esc(periodText)}</b> is now available.</p>
  ${payDate ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px"><tr><td style="padding:2px 0 2px 14px;border-left:3px solid ${GOLD}"><div style="font-size:12px;line-height:16px;color:${FAINT};text-transform:uppercase;letter-spacing:.8px">Pay Date</div><div style="font-size:16px;line-height:24px;font-weight:700;color:${INK}">${esc(payDate)}</div></td></tr></table>` : ''}
  <p style="margin:0 0 14px">Please review your payroll details below.</p>
  <p style="margin:0 0 18px">If you notice any discrepancy in your salary, attendance, deductions, or other payroll information, please contact HR${support ? ` at ${mailto(support)}` : ''}.</p>
  <p style="margin:0">Thank you,</p>
  <p style="margin:12px 0 0;line-height:22px"><b>HR &amp; Payroll Department</b><br><span style="color:${MUTED}">${COMPANY_NAME}</span></p>
</td></tr>

<!-- 3. The payslip, as a document -->
<tr><td class="pad" style="padding:22px 32px;background:${BAND};border-top:1px solid ${LINE};border-bottom:1px solid ${LINE}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border:1px solid #dcdfe3;border-radius:6px">
    <tr><td class="card-pad" style="padding:18px 24px 14px;border-bottom:1px solid ${LINE}">
      <div style="font-size:11px;line-height:16px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${GOLD}">Employee Payslip</div>
      <div style="font-size:20px;line-height:28px;font-weight:700;color:${INK};padding-top:2px">${esc(periodText)}</div>
      ${payDate ? `<div style="font-size:13px;line-height:20px;color:${MUTED}">Pay Date: ${esc(payDate)}</div>` : ''}
    </td></tr>
    <tr><td class="card-pad" style="padding:12px 24px 0">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${infoRows.join('')}</table>
    </td></tr>
    <tr><td class="cols" align="left" style="padding:0 16px 4px;font-size:0;line-height:0;text-align:left">
      <!--[if mso]><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td width="${COL}" valign="top"><![endif]-->${earningsCol}<!--[if mso]></td><td width="${COL}" valign="top"><![endif]-->${deductionsCol}<!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
    <tr><td class="card-pad" style="padding:16px 24px 22px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${GOLD_SOFT}" style="background:${GOLD_SOFT};border:1px solid ${GOLD_LINE};border-radius:6px"><tr><td align="center" style="padding:14px 12px">
        <div style="font-size:12px;line-height:16px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:${GOLD}">Net Pay</div>
        <div class="net" style="font-size:34px;line-height:42px;font-weight:700;color:${INK};padding-top:2px;white-space:nowrap">${peso(entry.net_pay)}</div>
      </td></tr></table>
    </td></tr>
  </table>
  ${button ? `<div style="padding-top:20px">${button}</div>` : ''}
</td></tr>

<!-- 4. Support + confidentiality -->
<tr><td class="pad" style="padding:28px 32px 0;font-size:14px;line-height:22px;color:${INK}">
  <div style="font-weight:700">Questions about your payslip?</div>
  <div style="color:${MUTED}">Please contact HR${contactEmail ? ` at ${mailto(contactEmail)}` : ''}.</div>
  ${support && hr ? `<div style="color:${MUTED};padding-top:8px">For attendance concerns: ${mailto(hr)}</div>` : ''}
</td></tr>
<tr><td class="pad" style="padding:30px 32px 0;font-size:13px;line-height:20px;color:${MUTED}">
  <div style="margin:0 0 10px;font-size:11px;line-height:16px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:${INK}">Confidentiality Notice</div>
  <p style="margin:0 0 10px">This email and its payslip contain confidential payroll information intended solely for the employee named above.</p>
  <p style="margin:0 0 10px;font-weight:600;color:${INK}">Unauthorized sharing, forwarding, copying, or disclosure of this payslip to any other person is not allowed without proper authorization.</p>
  <p style="margin:0">If you received this message in error, please notify HR immediately and delete it from your records.</p>
</td></tr>
<tr><td class="pad" style="padding:26px 32px 28px;font-size:12px;line-height:18px;color:${FAINT}">&copy; ${year} ${COMPANY_NAME}</td></tr>

</table></td></tr></table></body></html>`;
  return { subject, html };
}

export const isValidEmail = (v: unknown): v is string => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());

// Optional copy of every payslip email (PAYSLIP_BCC_EMAIL, one or more
// addresses separated by commas) so the company keeps its own proof of sending.
export function payslipCopyRecipients(): string[] {
  return (process.env.PAYSLIP_BCC_EMAIL || '').split(/[,;\s]+/).map(x => x.trim()).filter(x => x && isValidEmail(x));
}

// Mailboxes shown to employees for questions. Both are optional; nothing is
// printed unless it is set, so an address with no inbox is never advertised.
export function payslipContactEmails(): { support: string | null; hr: string | null } {
  const pick = (v: string | undefined) => (v && isValidEmail(v.trim()) ? v.trim() : null);
  return { support: pick(process.env.PAYSLIP_SUPPORT_EMAIL), hr: pick(process.env.PAYSLIP_HR_EMAIL) };
}

// The site the "View Payslip in Employee Portal" button points at.
export function appBaseUrl(): string {
  return (process.env.APP_URL || 'https://rpjcorp.com').replace(/\/+$/, '');
}
