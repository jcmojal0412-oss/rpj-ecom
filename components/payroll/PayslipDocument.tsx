'use client';

const COMPANY = {
  name: 'RPJ Trading Corporation',
  address: '426A Bulalakaw St Plainview, Mandaluyong City MM',
};

// Payslip-local labels — separate from PayrollClient's ADJUSTMENT_LABELS
// since "Salary Deduction" / "Cash Advance" are the payslip-facing terms
// requested for this document specifically (the admin Payroll screens keep
// their own existing labels, e.g. "Loan Deduction", untouched).
const EARNING_LABELS: Record<string, string> = {
  bonus: 'Bonus', incentive: 'Incentive', additional_allowance: 'Additional Allowance', other_earning: 'Salary Adjustment',
};
const DEDUCTION_LABELS: Record<string, string> = {
  cash_advance: 'Cash Advance', loan_deduction: 'Salary Deduction', other_deduction: 'Other Deductions',
};
const EARNING_TYPES = ['bonus', 'incentive', 'additional_allowance', 'other_earning'];

// Money is always "₱1,234.56" (two decimals, never "PHP 1,234.56"), whatever
// the browser's locale data says.
function peso(n: number): string {
  const v = Number(n) || 0;
  return `${v < 0 ? '−' : ''}₱${Math.abs(v).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Calendar dates (YYYY-MM-DD) are read as-is, so the day never shifts with the
// viewer's time zone: "Sep 1, 2026".
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-PH', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtOtHours(minutes: number): string {
  const hrs = minutes / 60;
  return `${Number.isInteger(hrs) ? hrs : hrs.toFixed(1)} hrs`;
}

function fmtDays(n: number): string {
  return `${Number.isInteger(n) ? n : n.toFixed(1)} day${n === 1 ? '' : 's'}`;
}

// "Sep 23, 2026 • 5:16 PM" in Philippine time; empty when there is no real
// timestamp (the field is then left off the payslip rather than shown blank).
function fmtGenerated(sqliteUtc: string | null | undefined): string {
  if (!sqliteUtc) return '';
  const d = new Date(String(sqliteUtc).replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' }).replace(/[  ]/g, ' ');
  return `${date} • ${time}`;
}

// The printable payslip itself, shared by the full page (/payslips/[id]), the
// bulk print page and the pop-up on the Payslips page so they can never drift
// apart. It only draws the document: the page adds its own toolbar / A4 sheet.
// `contactEmail` is the configured payroll mailbox (nothing is printed when
// none is set); `warning` is an on-screen-only note for HR (never printed).
export default function PayslipDocument({ entry, adjustments, contactEmail, warning }: { entry: any; adjustments: any[]; contactEmail?: string | null; warning?: string | null }) {
  const earnings = adjustments.filter((a: any) => EARNING_TYPES.includes(a.adjustment_type));
  const manualDeductions = adjustments.filter((a: any) => !EARNING_TYPES.includes(a.adjustment_type));

  const isDaily = entry.salary_type_snapshot === 'Daily';
  // Fixed-rate (freelance) pay has no attendance, so there are no days to show.
  const fixedRate = entry.pay_basis_snapshot === 'fixed';
  const basicPayLabel = isDaily ? `Scheduled Basic Pay (${fmtDays(entry.work_days_count)})` : 'Basic Pay';
  const daysWorked = Math.max(0, entry.work_days_count - entry.absence_days - entry.unpaid_leave_days);

  const absenceUnpaidDays = entry.absence_days + entry.unpaid_leave_days;
  const absenceUnpaidAmount = entry.absence_deduction + entry.unpaid_leave_deduction;

  // Stored on the payroll record (unique, filled automatically); the formula is
  // only a fallback for a record that somehow has none.
  const referenceNo = entry.payslip_ref || `PS-${String(entry.to_date).replace(/-/g, '')}-${String(entry.id).padStart(5, '0')}`;
  // When this payslip was issued: its own release time, else the period-wide one.
  const generated = fmtGenerated(entry.payslip_released_at || entry.payslips_generated_at);

  return (
    <>
    <div className="ps-doc">

      {warning && <div className="ps-warn" role="alert">⚠ {warning}</div>}

      <div className="ps-head">
        <div className="ps-head-left">
          <img className="ps-logo" src="/email-logo.png" alt="RPJ Corp" />
          <div>
            <div className="ps-co-name">{COMPANY.name}</div>
            <div className="ps-co-sub">Bodega ni Suki &middot; {COMPANY.address}</div>
          </div>
        </div>
        <div className="ps-head-right">
          <div className="ps-doc-title">PAYSLIP</div>
          <div className="ps-doc-meta">
            <div><b>Ref No.</b> {referenceNo}</div>
            {generated && <div><b>Generated</b> {generated}</div>}
          </div>
        </div>
      </div>

      <div className="ps-emp-grid">
        <div className="ps-emp-field"><span className="ps-emp-label">Employee ID</span><span className="ps-emp-value">{entry.employee_code_snapshot}</span></div>
        <div className="ps-emp-field"><span className="ps-emp-label">Employee Name</span><span className="ps-emp-value">{entry.employee_name_snapshot}</span></div>
        <div className="ps-emp-field"><span className="ps-emp-label">Position</span><span className="ps-emp-value">{entry.position_snapshot || '—'}</span></div>
        <div className="ps-emp-field"><span className="ps-emp-label">Salary Type</span><span className="ps-emp-value">{fixedRate ? 'Monthly · Fixed rate' : entry.salary_type_snapshot}</span></div>
        <div className="ps-emp-field"><span className="ps-emp-label">{isDaily ? 'Daily Rate' : 'Monthly Salary'}</span><span className="ps-emp-value">{peso(entry.basic_rate_snapshot)}</span></div>
        <div className="ps-emp-field"><span className="ps-emp-label">Pay Date</span><span className="ps-emp-value">{fmtDate(entry.pay_date || entry.to_date)}</span></div>
        <div className="ps-emp-field"><span className="ps-emp-label">Pay Period</span><span className="ps-emp-value">{fmtDate(entry.from_date)} &ndash; {fmtDate(entry.to_date)}</span></div>
        {fixedRate
          ? <div className="ps-emp-field"><span className="ps-emp-label">Pay Basis</span><span className="ps-emp-value">Fixed rate</span></div>
          : <div className="ps-emp-field"><span className="ps-emp-label">Days Worked</span><span className="ps-emp-value">{daysWorked} / {entry.work_days_count}</span></div>}
      </div>

      <div className="ps-cols">
        <div className="ps-panel">
          <div className="ps-panel-head">Earnings</div>
          <div className="ps-row"><span className="ps-lbl">{basicPayLabel}</span><span className="ps-amt">{peso(entry.basic_pay)}</span></div>
          {entry.ot_pay > 0 && <div className="ps-row"><span className="ps-lbl">Overtime <span className="ps-reason">({fmtOtHours(entry.approved_ot_minutes)})</span></span><span className="ps-amt">{peso(entry.ot_pay)}</span></div>}
          {entry.allowance_pay > 0 && <div className="ps-row"><span className="ps-lbl">Allowance</span><span className="ps-amt">{peso(entry.allowance_pay)}</span></div>}
          {earnings.map((a: any, i: number) => (
            <div className="ps-row" key={i}><span className="ps-lbl">{EARNING_LABELS[a.adjustment_type]} <span className="ps-reason">— {a.reason}</span></span><span className="ps-amt">{peso(a.amount)}</span></div>
          ))}
          <div className="ps-row ps-sub"><span className="ps-lbl">Total Earnings</span><span className="ps-amt">{peso(entry.gross_pay)}</span></div>
        </div>

        <div className="ps-panel">
          <div className="ps-panel-head ps-ded">Deductions</div>
          <div className="ps-row"><span className="ps-lbl">SSS</span><span className="ps-amt">{peso(entry.sss_ee_contribution)}</span></div>
          <div className="ps-row"><span className="ps-lbl">PhilHealth</span><span className="ps-amt">{peso(entry.philhealth_ee_contribution)}</span></div>
          <div className="ps-row"><span className="ps-lbl">Pag-IBIG</span><span className="ps-amt">{peso(entry.pagibig_ee_contribution)}</span></div>
          {entry.late_deduction > 0 && <div className="ps-row"><span className="ps-lbl">Late <span className="ps-reason">({entry.late_minutes} mins)</span></span><span className="ps-amt">{peso(entry.late_deduction)}</span></div>}
          {entry.undertime_deduction > 0 && <div className="ps-row"><span className="ps-lbl">Undertime <span className="ps-reason">({entry.undertime_minutes} mins)</span></span><span className="ps-amt">{peso(entry.undertime_deduction)}</span></div>}
          {absenceUnpaidAmount > 0 && <div className="ps-row"><span className="ps-lbl">Absence / Unpaid Leave <span className="ps-reason">({fmtDays(absenceUnpaidDays)})</span></span><span className="ps-amt">{peso(absenceUnpaidAmount)}</span></div>}
          {entry.excess_break_deduction > 0 && <div className="ps-row"><span className="ps-lbl">Excess Break</span><span className="ps-amt">{peso(entry.excess_break_deduction)}</span></div>}
          {manualDeductions.map((a: any, i: number) => (
            <div className="ps-row" key={i}><span className="ps-lbl">{DEDUCTION_LABELS[a.adjustment_type]} <span className="ps-reason">— {a.reason}</span></span><span className="ps-amt">{peso(a.amount)}</span></div>
          ))}
          <div className="ps-row ps-sub"><span className="ps-lbl">Total Deductions</span><span className="ps-amt">{peso(entry.total_deductions)}</span></div>
        </div>
      </div>

      <div className="ps-net-pay">
        <div className="ps-net-lbl">Net Pay<small>Total Earnings &minus; Total Deductions</small></div>
        <div className="ps-net-amt">{peso(entry.net_pay)}</div>
      </div>

      <div className="ps-footer">
        <p>This payslip is computer-generated and reflects the approved payroll record.</p>
        <p>For payroll concerns or discrepancies, please contact HR{contactEmail ? <> at <b>{contactEmail}</b></> : ''}.</p>
        <p className="ps-footer-sub">This document contains confidential employee payroll information.</p>
      </div>
    </div>
      <style jsx global>{`
        :root {
          --ps-ink: #24262a; --ps-ink-soft: #4a4e54; --ps-label: #6b7076; --ps-ink-faint: #7b8087;
          --ps-line: #d2d4d8; --ps-line-soft: #eef0f2; --ps-silver: #5b5f66;
          --ps-accent-ink: #7a5a17;
          --ps-net-bg: #202226; --ps-net-accent: #d9ad42;
        }
        /* Type scale: 10 labels · 11 secondary · 11.5 rows · 12.5 values · 13 title · 17 company · 30 net pay */
        .ps-doc { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: var(--ps-ink); font-variant-numeric: tabular-nums; }
        /* Inside a pop-up: fill the dialog instead of being an A4 sheet. */
        .ps-embedded .ps-doc { background: #fff; width: 100%; min-height: 0; padding: 20px; box-shadow: none; }

        .ps-warn { background: #fef3c7; border: 1px solid #f59e0b; color: #7c2d12; font-size: 12px; line-height: 1.5; font-weight: 600; padding: 9px 12px; border-radius: 6px; margin-bottom: 16px; }

        .ps-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; border-bottom: 3px solid var(--ps-ink); padding-bottom: 16px; margin-bottom: 20px; }
        .ps-head-left { display: flex; align-items: center; gap: 14px; }
        .ps-logo { width: 52px; height: 52px; object-fit: contain; flex-shrink: 0; }
        .ps-co-name { font-size: 17px; line-height: 1.25; font-weight: 700; letter-spacing: 0.2px; color: var(--ps-ink); }
        .ps-co-sub { font-size: 11px; line-height: 1.4; color: var(--ps-ink-soft); margin-top: 3px; }
        .ps-head-right { text-align: right; flex-shrink: 0; }
        .ps-doc-title { font-size: 13px; line-height: 1.3; font-weight: 700; letter-spacing: 2.5px; color: var(--ps-accent-ink); }
        .ps-doc-meta { font-size: 11px; color: var(--ps-ink-soft); margin-top: 5px; line-height: 1.55; }
        .ps-doc-meta b { color: var(--ps-ink); font-weight: 600; }

        .ps-emp-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px 20px; align-items: start; margin-bottom: 22px; padding: 14px 16px; background: var(--ps-line-soft); border-radius: 6px; }
        .ps-emp-field { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
        .ps-emp-label { font-size: 10px; line-height: 1.3; text-transform: uppercase; letter-spacing: 0.8px; color: var(--ps-label); }
        .ps-emp-value { font-size: 12.5px; line-height: 1.35; font-weight: 600; color: var(--ps-ink); }

        .ps-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-bottom: 4px; align-items: start; }
        .ps-panel { border: 1px solid var(--ps-line); border-radius: 6px; overflow: hidden; }
        .ps-panel-head { background: var(--ps-silver); color: #fff; font-size: 11px; line-height: 1.3; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; padding: 8px 12px; }
        .ps-panel-head.ps-ded { background: var(--ps-accent-ink); }
        .ps-row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 7px 12px; font-size: 11.5px; line-height: 1.4; border-bottom: 1px solid var(--ps-line-soft); }
        .ps-row:last-of-type { border-bottom: none; }
        .ps-lbl { color: var(--ps-ink-soft); }
        .ps-reason { color: var(--ps-ink-faint); font-size: 10px; font-style: italic; }
        .ps-amt { font-weight: 600; color: var(--ps-ink); text-align: right; white-space: nowrap; flex-shrink: 0; }
        .ps-row.ps-sub { background: var(--ps-line-soft); font-weight: 700; padding: 8px 12px; border-top: 1.5px solid var(--ps-line); }
        .ps-row.ps-sub .ps-lbl { color: var(--ps-ink); }
        .ps-row.ps-sub .ps-amt { color: var(--ps-ink); }

        .ps-net-pay { margin-top: 18px; background: var(--ps-net-bg); border-radius: 8px; padding: 20px 26px; display: flex; justify-content: space-between; align-items: center; gap: 16px; }
        .ps-net-lbl { color: #d5d7db; font-size: 12px; line-height: 1.3; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; }
        .ps-net-lbl small { display: block; font-size: 10px; line-height: 1.4; font-weight: 400; letter-spacing: 0.3px; color: #a9acb2; margin-top: 4px; text-transform: none; }
        .ps-net-amt { color: var(--ps-net-accent); font-size: 30px; line-height: 1.1; font-weight: 700; letter-spacing: -0.3px; white-space: nowrap; text-align: right; }

        .ps-footer { margin-top: 18px; text-align: center; font-size: 11px; line-height: 1.6; color: var(--ps-ink-soft); }
        .ps-footer p { margin: 0; }
        .ps-footer b { color: var(--ps-ink); font-weight: 600; }
        .ps-footer .ps-footer-sub { margin-top: 3px; color: var(--ps-ink-faint); }

        @media (max-width: 640px) {
          .ps-cols { grid-template-columns: 1fr; }
          .ps-emp-grid { grid-template-columns: 1fr 1fr; }
          .ps-head { flex-direction: column; }
          .ps-head-right { text-align: left; }
        }
        @media screen and (max-width: 640px) {
          .ps-head { gap: 12px; }
          .ps-head-left { min-width: 0; }
          .ps-emp-grid { padding: 12px; gap: 10px 14px; }
          .ps-emp-value { overflow-wrap: anywhere; }
          .ps-net-pay { padding: 16px 18px; flex-wrap: wrap; gap: 6px 12px; }
          .ps-net-amt { font-size: 26px; }
        }

        /* Print / Save as PDF: keep the fills, and never split a row or a block across pages. */
        @media print {
          .ps-warn { display: none !important; }
          .ps-emp-grid, .ps-panel-head, .ps-row.ps-sub, .ps-net-pay { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .ps-head, .ps-emp-grid, .ps-row, .ps-net-pay, .ps-footer { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>
    </>
  );
}
