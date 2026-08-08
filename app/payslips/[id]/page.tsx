'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { formatCurrency, formatDate } from '@/lib/utils';

const COMPANY = {
  name: 'RPJ Trading Corporation',
  address: '426A Bulalakaw St Plainview, Mandaluyong City MM',
};

const ADJUSTMENT_LABELS: Record<string, string> = {
  bonus: 'Bonus', incentive: 'Incentive', additional_allowance: 'Additional Allowance', other_earning: 'Other Earning',
  cash_advance: 'Cash Advance', loan_deduction: 'Loan Deduction', other_deduction: 'Other Deduction',
};
const EARNING_TYPES = ['bonus', 'incentive', 'additional_allowance', 'other_earning'];

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

      <div className="payslip-page" style={{ paddingTop: '60px' }}>
        <div className="payslip-doc">
          <div style={{ textAlign: 'center', borderBottom: '2px solid #333', paddingBottom: '12px', marginBottom: '16px' }}>
            <div style={{ fontSize: '16px', fontWeight: 700 }}>{COMPANY.name}</div>
            <div style={{ fontSize: '10px', color: '#555' }}>{COMPANY.address}</div>
            <div style={{ fontSize: '13px', fontWeight: 600, marginTop: '10px', letterSpacing: '1px' }}>PAYSLIP</div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 24px', fontSize: '11px', marginBottom: '16px' }}>
            <div><b>Employee Name:</b> {entry.employee_name_snapshot}</div>
            <div><b>Employee ID:</b> {entry.employee_code_snapshot}</div>
            <div><b>Position:</b> {entry.position_snapshot || '—'}</div>
            <div><b>Payroll Period:</b> {entry.period_label} ({formatDate(entry.from_date)} – {formatDate(entry.to_date)})</div>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', marginBottom: '10px' }}>
            <thead>
              <tr style={{ background: '#f3f4f6' }}>
                <th style={{ textAlign: 'left', padding: '6px 8px', border: '1px solid #ddd' }}>Earnings</th>
                <th style={{ textAlign: 'right', padding: '6px 8px', border: '1px solid #ddd', width: '110px' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr><td style={{ padding: '5px 8px', border: '1px solid #eee' }}>Basic Pay</td><td style={{ textAlign: 'right', padding: '5px 8px', border: '1px solid #eee' }}>{formatCurrency(entry.basic_pay)}</td></tr>
              {entry.ot_pay > 0 && <tr><td style={{ padding: '5px 8px', border: '1px solid #eee' }}>Overtime Pay</td><td style={{ textAlign: 'right', padding: '5px 8px', border: '1px solid #eee' }}>{formatCurrency(entry.ot_pay)}</td></tr>}
              {entry.allowance_pay > 0 && <tr><td style={{ padding: '5px 8px', border: '1px solid #eee' }}>Allowance</td><td style={{ textAlign: 'right', padding: '5px 8px', border: '1px solid #eee' }}>{formatCurrency(entry.allowance_pay)}</td></tr>}
              {earnings.map((a: any, i: number) => (
                <tr key={i}><td style={{ padding: '5px 8px', border: '1px solid #eee' }}>{ADJUSTMENT_LABELS[a.adjustment_type]} ({a.reason})</td><td style={{ textAlign: 'right', padding: '5px 8px', border: '1px solid #eee' }}>{formatCurrency(a.amount)}</td></tr>
              ))}
              <tr style={{ fontWeight: 700 }}><td style={{ padding: '6px 8px', border: '1px solid #ddd' }}>Gross Pay</td><td style={{ textAlign: 'right', padding: '6px 8px', border: '1px solid #ddd' }}>{formatCurrency(entry.gross_pay)}</td></tr>
            </tbody>
          </table>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', marginBottom: '16px' }}>
            <thead>
              <tr style={{ background: '#f3f4f6' }}>
                <th style={{ textAlign: 'left', padding: '6px 8px', border: '1px solid #ddd' }}>Deductions</th>
                <th style={{ textAlign: 'right', padding: '6px 8px', border: '1px solid #ddd', width: '110px' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {entry.late_deduction > 0 && <tr><td style={{ padding: '5px 8px', border: '1px solid #eee' }}>Late</td><td style={{ textAlign: 'right', padding: '5px 8px', border: '1px solid #eee' }}>{formatCurrency(entry.late_deduction)}</td></tr>}
              {entry.undertime_deduction > 0 && <tr><td style={{ padding: '5px 8px', border: '1px solid #eee' }}>Undertime</td><td style={{ textAlign: 'right', padding: '5px 8px', border: '1px solid #eee' }}>{formatCurrency(entry.undertime_deduction)}</td></tr>}
              {entry.absence_deduction > 0 && <tr><td style={{ padding: '5px 8px', border: '1px solid #eee' }}>Absence</td><td style={{ textAlign: 'right', padding: '5px 8px', border: '1px solid #eee' }}>{formatCurrency(entry.absence_deduction)}</td></tr>}
              {entry.unpaid_leave_deduction > 0 && <tr><td style={{ padding: '5px 8px', border: '1px solid #eee' }}>Unpaid Leave</td><td style={{ textAlign: 'right', padding: '5px 8px', border: '1px solid #eee' }}>{formatCurrency(entry.unpaid_leave_deduction)}</td></tr>}
              {entry.excess_break_deduction > 0 && <tr><td style={{ padding: '5px 8px', border: '1px solid #eee' }}>Excess Break</td><td style={{ textAlign: 'right', padding: '5px 8px', border: '1px solid #eee' }}>{formatCurrency(entry.excess_break_deduction)}</td></tr>}
              {manualDeductions.map((a: any, i: number) => (
                <tr key={i}><td style={{ padding: '5px 8px', border: '1px solid #eee' }}>{ADJUSTMENT_LABELS[a.adjustment_type]} ({a.reason})</td><td style={{ textAlign: 'right', padding: '5px 8px', border: '1px solid #eee' }}>{formatCurrency(a.amount)}</td></tr>
              ))}
              {entry.total_deductions === 0 && <tr><td style={{ padding: '5px 8px', border: '1px solid #eee', color: '#999' }} colSpan={2}>No deductions</td></tr>}
              <tr style={{ fontWeight: 700 }}><td style={{ padding: '6px 8px', border: '1px solid #ddd' }}>Total Deductions</td><td style={{ textAlign: 'right', padding: '6px 8px', border: '1px solid #ddd' }}>{formatCurrency(entry.total_deductions)}</td></tr>
            </tbody>
          </table>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#111', color: 'white', padding: '14px 18px', borderRadius: '6px' }}>
            <span style={{ fontSize: '13px', fontWeight: 700, letterSpacing: '1px' }}>NET PAY</span>
            <span style={{ fontSize: '20px', fontWeight: 700 }}>{formatCurrency(entry.net_pay)}</span>
          </div>

          <p style={{ fontSize: '9px', color: '#999', marginTop: '20px', textAlign: 'center' }}>
            This payslip is computer-generated and reflects the payroll record as approved. For questions, please contact HR.
          </p>
        </div>
      </div>

      <style jsx global>{`
        @media screen {
          body { background: #e5e7eb; }
          .payslip-page { min-height: 100vh; display: flex; justify-content: center; padding: 20px; }
          .payslip-doc { background: white; width: 210mm; min-height: 150mm; padding: 16mm; box-shadow: 0 4px 24px rgba(0,0,0,0.15); }
        }
        @media print {
          @page { margin: 12mm 14mm; size: A4; }
          body { background: white !important; }
          .no-print { display: none !important; }
          .payslip-page { padding: 0 !important; }
          .payslip-doc { box-shadow: none !important; width: 100% !important; padding: 0 !important; }
        }
      `}</style>
    </>
  );
}
