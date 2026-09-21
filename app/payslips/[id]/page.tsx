'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import PayslipDocument from '@/components/payroll/PayslipDocument';

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

  // Records that the payslip was printed (shown as its status on the Payslips
  // page), then opens the browser's print dialog.
  const printPayslip = () => {
    fetch(`/api/payslips/${params.id}/track`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'printed' }) }).catch(() => {});
    window.print();
  };

  // "Print Payslip" from the Payslips page opens this with ?print=1.
  useEffect(() => {
    if (!data) return;
    if (new URLSearchParams(window.location.search).get('print') === '1') setTimeout(printPayslip, 500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (error) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-red-500">{error}</div>;
  }
  if (!data) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-gray-400">Loading...</div>;
  }

  const { entry, adjustments, contact_email, calc_warning } = data;
  return (
    <>
      <div className="no-print fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-3 sm:px-6 py-2 sm:py-3 bg-gray-900 text-white shadow-xl">
        <button onClick={() => router.back()} className="text-sm text-gray-400 hover:text-white transition-colors py-2 pr-3 sm:p-0">← Back</button>
        <button
          onClick={printPayslip}
          className="flex items-center gap-2 px-4 sm:px-5 py-2.5 sm:py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          🖨️ Print / Save as PDF
        </button>
      </div>

      <div className="ps-page" style={{ paddingTop: '60px' }}>
        <PayslipDocument entry={entry} adjustments={adjustments} contactEmail={contact_email} warning={calc_warning} />
      </div>

      <style jsx global>{`
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

        /* Phone screen only (never print): the A4-width sheet would otherwise
           force sideways page scroll, so let it fill the screen instead. */
        @media screen and (max-width: 640px) {
          .ps-page { padding: 8px !important; padding-top: 60px !important; }
          .ps-doc { width: 100%; min-width: 0; min-height: 0; padding: 14px; }
        }
      `}</style>
    </>
  );
}
