'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { formatCurrency, formatDate } from '@/lib/utils';

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

function fmtOtHours(minutes: number): string {
  const hrs = minutes / 60;
  return `${Number.isInteger(hrs) ? hrs : hrs.toFixed(1)} hrs`;
}

function fmtDays(n: number): string {
  return `${Number.isInteger(n) ? n : n.toFixed(1)} day${n === 1 ? '' : 's'}`;
}

function fmtGeneratedAt(sqliteUtc: string | null): string {
  if (!sqliteUtc) return '—';
  const d = new Date(sqliteUtc.replace(' ', 'T') + 'Z');
  return d.toLocaleString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function PayslipPrintPage() {
  const params = useParams();
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/payslips/${params.id}`).then(async r => {
      const d = await r.json();
      if (!r.ok) { setError(d.error || 'Not found'); return; }
      setData(d);
    });
  }, [params.id]);

  if (error) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-red-500">{error}</div>;
  }
  if (!data) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-gray-400">Loading...</div>;
  }

  const { entry, adjustments } = data;
  const earnings = adjustments.filter((a: any) => EARNING_TYPES.includes(a.adjustment_type));
  const manualDeductions = adjustments.filter((a: any) => !EARNING_TYPES.includes(a.adjustment_type));

  const isDaily = entry.salary_type_snapshot === 'Daily';
  const basicPayLabel = isDaily ? `Scheduled Basic Pay (${fmtDays(entry.work_days_count)})` : 'Basic Pay';
  const daysWorked = Math.max(0, entry.work_days_count - entry.absence_days - entry.unpaid_leave_days);

  const absenceUnpaidDays = entry.absence_days + entry.unpaid_leave_days;
  const absenceUnpaidAmount = entry.absence_deduction + entry.unpaid_leave_deduction;

  const referenceNo = `PS-${String(entry.to_date).replace(/-/g, '')}-${String(entry.id).padStart(5, '0')}`;

  return (
    <>
      <div className="no-print fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-3 bg-gray-900 text-white shadow-xl">
        <button onClick={() => router.back()} className="text-sm text-gray-400 hover:text-white transition-colors">← Back</button>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 px-5 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          🖨️ Print / Save as PDF
        </button>
      </div>

      <div className="ps-page" style={{ paddingTop: '60px' }}>
        <div className="ps-doc">

          <div className="ps-head">
            <div className="ps-head-left">
              <img className="ps-logo" src="/logo.png" alt="RPJ Corp" />
              <div>
                <div className="ps-co-name">{COMPANY.name}</div>
                <div className="ps-co-sub">Bodega ni Suki &middot; {COMPANY.address}</div>
              </div>
            </div>
            <div className="ps-head-right">
              <div className="ps-doc-title">PAYSLIP</div>
              <div className="ps-doc-meta"><b>Ref No.</b> {referenceNo}<br /><b>Generated</b> {fmtGeneratedAt(entry.payslips_generated_at)}</div>
            </div>
          </div>

          <div className="ps-emp-grid">
            <div className="ps-emp-field"><span className="ps-emp-label">Employee ID</span><span className="ps-emp-value">{entry.employee_code_snapshot}</span></div>
            <div className="ps-emp-field"><span className="ps-emp-label">Employee Name</span><span className="ps-emp-value">{entry.employee_name_snapshot}</span></div>
            <div className="ps-emp-field"><span className="ps-emp-label">Position</span><span className="ps-emp-value">{entry.position_snapshot || '—'}</span></div>
            <div className="ps-emp-field"><span className="ps-emp-label">Salary Type</span><span className="ps-emp-value">{entry.salary_type_snapshot}</span></div>
            <div className="ps-emp-field"><span className="ps-emp-label">{isDaily ? 'Daily Rate' : 'Monthly Salary'}</span><span className="ps-emp-value">{formatCurrency(entry.basic_rate_snapshot)}</span></div>
            <div className="ps-emp-field"><span className="ps-emp-label">Pay Date</span><span className="ps-emp-value">{formatDate(entry.pay_date || entry.to_date)}</span></div>
            <div className="ps-emp-field"><span className="ps-emp-label">Pay Period</span><span className="ps-emp-value">{formatDate(entry.from_date)}&ndash;{formatDate(entry.to_date)}</span></div>
            <div className="ps-emp-field"><span className="ps-emp-label">Days Worked</span><span className="ps-emp-value">{daysWorked} / {entry.work_days_count}</span></div>
          </div>

          <div className="ps-cols">
            <div className="ps-panel">
              <div className="ps-panel-head">Earnings</div>
              <div className="ps-row"><span className="ps-lbl">{basicPayLabel}</span><span className="ps-amt">{formatCurrency(entry.basic_pay)}</span></div>
              {entry.ot_pay > 0 && <div className="ps-row"><span className="ps-lbl">Overtime <span className="ps-reason">({fmtOtHours(entry.approved_ot_minutes)})</span></span><span className="ps-amt">{formatCurrency(entry.ot_pay)}</span></div>}
              {entry.allowance_pay > 0 && <div className="ps-row"><span className="ps-lbl">Allowance</span><span className="ps-amt">{formatCurrency(entry.allowance_pay)}</span></div>}
              {earnings.map((a: any, i: number) => (
                <div className="ps-row" key={i}><span className="ps-lbl">{EARNING_LABELS[a.adjustment_type]} <span className="ps-reason">— {a.reason}</span></span><span className="ps-amt">{formatCurrency(a.amount)}</span></div>
              ))}
              <div className="ps-row ps-sub"><span className="ps-lbl">Total Earnings</span><span className="ps-amt">{formatCurrency(entry.gross_pay)}</span></div>
            </div>

            <div className="ps-panel">
              <div className="ps-panel-head ps-ded">Deductions</div>
              <div className="ps-row"><span className="ps-lbl">SSS</span><span className="ps-amt">{formatCurrency(entry.sss_ee_contribution)}</span></div>
              <div className="ps-row"><span className="ps-lbl">PhilHealth</span><span className="ps-amt">{formatCurrency(entry.philhealth_ee_contribution)}</span></div>
              <div className="ps-row"><span className="ps-lbl">Pag-IBIG</span><span className="ps-amt">{formatCurrency(entry.pagibig_ee_contribution)}</span></div>
              {entry.late_deduction > 0 && <div className="ps-row"><span className="ps-lbl">Late <span className="ps-reason">({entry.late_minutes} mins)</span></span><span className="ps-amt">{formatCurrency(entry.late_deduction)}</span></div>}
              {entry.undertime_deduction > 0 && <div className="ps-row"><span className="ps-lbl">Undertime <span className="ps-reason">({entry.undertime_minutes} mins)</span></span><span className="ps-amt">{formatCurrency(entry.undertime_deduction)}</span></div>}
              {absenceUnpaidAmount > 0 && <div className="ps-row"><span className="ps-lbl">Absence / Unpaid Leave <span className="ps-reason">({fmtDays(absenceUnpaidDays)})</span></span><span className="ps-amt">{formatCurrency(absenceUnpaidAmount)}</span></div>}
              {entry.excess_break_deduction > 0 && <div className="ps-row"><span className="ps-lbl">Excess Break</span><span className="ps-amt">{formatCurrency(entry.excess_break_deduction)}</span></div>}
              {manualDeductions.map((a: any, i: number) => (
                <div className="ps-row" key={i}><span className="ps-lbl">{DEDUCTION_LABELS[a.adjustment_type]} <span className="ps-reason">— {a.reason}</span></span><span className="ps-amt">{formatCurrency(a.amount)}</span></div>
              ))}
              <div className="ps-row ps-sub"><span className="ps-lbl">Total Deductions</span><span className="ps-amt">{formatCurrency(entry.total_deductions)}</span></div>
            </div>
          </div>

          <div className="ps-net-pay">
            <div className="ps-net-lbl">Net Pay<small>Total Earnings &minus; Total Deductions</small></div>
            <div className="ps-net-amt">{formatCurrency(entry.net_pay)}</div>
          </div>

          <p className="ps-footer-note">This payslip is computer-generated and reflects the payroll record as approved. For questions, please contact HR.</p>
        </div>
      </div>

      <style jsx global>{`
        :root {
          --ps-ink: #24262a; --ps-ink-soft: #5c6066; --ps-ink-faint: #8d9198;
          --ps-line: #d2d4d8; --ps-line-soft: #eef0f2; --ps-silver: #5b5f66;
          --ps-accent-ink: #7a5a17;
          --ps-net-bg: #202226; --ps-net-bg-2: #34373c; --ps-net-accent: #d9ad42;
        }
        @media screen {
          body { background: #e5e7eb; }
          .ps-page { min-height: 100vh; display: flex; justify-content: center; padding: 20px; }
          .ps-doc { background: white; width: 210mm; min-height: 150mm; padding: 16mm; box-shadow: 0 4px 24px rgba(0,0,0,0.15); font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: var(--ps-ink); font-variant-numeric: tabular-nums; }
        }
        @media print {
          @page { margin: 12mm 14mm; size: A4; }
          body { background: white !important; }
          .no-print { display: none !important; }
          .ps-page { padding: 0 !important; }
          .ps-doc { box-shadow: none !important; width: 100% !important; padding: 0 !important; font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: var(--ps-ink); font-variant-numeric: tabular-nums; }
          .ps-net-pay, .ps-panel-head { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }

        .ps-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; border-bottom: 3px solid var(--ps-ink); padding-bottom: 16px; margin-bottom: 20px; }
        .ps-head-left { display: flex; align-items: center; gap: 14px; }
        .ps-logo { width: 52px; height: 52px; object-fit: contain; flex-shrink: 0; }
        .ps-co-name { font-size: 17px; font-weight: 700; letter-spacing: 0.2px; }
        .ps-co-sub { font-size: 10.5px; color: var(--ps-ink-soft); margin-top: 2px; }
        .ps-head-right { text-align: right; flex-shrink: 0; }
        .ps-doc-title { font-size: 13px; font-weight: 700; letter-spacing: 2.5px; color: var(--ps-accent-ink); }
        .ps-doc-meta { font-size: 10px; color: var(--ps-ink-faint); margin-top: 5px; line-height: 1.5; }
        .ps-doc-meta b { color: var(--ps-ink-soft); font-weight: 600; }

        .ps-emp-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px 20px; margin-bottom: 22px; padding: 14px 16px; background: var(--ps-line-soft); border-radius: 6px; }
        .ps-emp-field { display: flex; flex-direction: column; gap: 2px; }
        .ps-emp-label { font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.8px; color: var(--ps-ink-faint); }
        .ps-emp-value { font-size: 12.5px; font-weight: 600; color: var(--ps-ink); }

        .ps-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-bottom: 4px; }
        .ps-panel { border: 1px solid var(--ps-line); border-radius: 6px; overflow: hidden; }
        .ps-panel-head { background: var(--ps-silver); color: #fff; font-size: 11px; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; padding: 8px 12px; }
        .ps-panel-head.ps-ded { background: var(--ps-accent-ink); }
        .ps-row { display: flex; justify-content: space-between; align-items: baseline; padding: 6.5px 12px; font-size: 11.5px; border-bottom: 1px solid var(--ps-line-soft); }
        .ps-row:last-of-type { border-bottom: none; }
        .ps-lbl { color: var(--ps-ink-soft); }
        .ps-reason { color: var(--ps-ink-faint); font-size: 10px; font-style: italic; }
        .ps-amt { font-weight: 600; color: var(--ps-ink); }
        .ps-row.ps-sub { background: var(--ps-line-soft); font-weight: 700; padding: 8px 12px; border-top: 1.5px solid var(--ps-line); }
        .ps-row.ps-sub .ps-amt { color: var(--ps-ink); }

        .ps-net-pay { margin-top: 18px; background: linear-gradient(135deg, var(--ps-net-bg), var(--ps-net-bg-2)); border-radius: 8px; padding: 18px 24px; display: flex; justify-content: space-between; align-items: center; }
        .ps-net-lbl { color: #cdd0d4; font-size: 12px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; }
        .ps-net-lbl small { display: block; font-size: 9.5px; font-weight: 400; letter-spacing: 0.3px; color: #92959b; margin-top: 3px; text-transform: none; }
        .ps-net-amt { color: var(--ps-net-accent); font-size: 30px; font-weight: 700; letter-spacing: -0.5px; }

        .ps-footer-note { margin-top: 16px; font-size: 9px; color: var(--ps-ink-faint); text-align: center; line-height: 1.6; }

        @media (max-width: 640px) {
          .ps-cols { grid-template-columns: 1fr; }
          .ps-emp-grid { grid-template-columns: 1fr 1fr; }
          .ps-head { flex-direction: column; }
          .ps-head-right { text-align: left; }
        }
      `}</style>
    </>
  );
}
