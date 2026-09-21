'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import PayslipDocument from '@/components/payroll/PayslipDocument';

// Several payslips in one print job (one per page) — opened from the bulk
// "Print / Save as PDF" action on the Payslips page as /payslips/print?ids=1,2,3.
// Each payslip is read through the normal /api/payslips/[id], so a viewer only
// ever gets the ones they are allowed to see.
export default function BulkPayslipPrintPage() {
  const router = useRouter();
  const [docs, setDocs] = useState<any[] | null>(null);
  const [skipped, setSkipped] = useState(0);

  useEffect(() => {
    const ids = (new URLSearchParams(window.location.search).get('ids') ?? '')
      .split(',').map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 50);
    Promise.all(ids.map(id =>
      fetch(`/api/payslips/${id}`).then(async r => (r.ok ? { id, ...(await r.json()) } : null)).catch(() => null),
    )).then(res => {
      const ok = res.filter(Boolean) as any[];
      setDocs(ok);
      setSkipped(ids.length - ok.length);
    });
  }, []);

  // Records every payslip in the batch as printed, then opens the print dialog.
  const printAll = () => {
    (docs ?? []).forEach(d => {
      fetch(`/api/payslips/${d.id}/track`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'printed' }) }).catch(() => {});
    });
    window.print();
  };

  useEffect(() => {
    if (!docs || docs.length === 0) return;
    if (new URLSearchParams(window.location.search).get('print') === '1') setTimeout(printAll, 600);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs]);

  if (!docs) return <div className="min-h-screen flex items-center justify-center text-sm text-gray-400">Loading…</div>;

  return (
    <>
      <div className="no-print fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-3 sm:px-6 py-2 sm:py-3 bg-gray-900 text-white shadow-xl">
        <button onClick={() => router.back()} className="text-sm text-gray-400 hover:text-white transition-colors py-2 pr-3 sm:p-0">← Back</button>
        <span className="text-xs text-gray-400 hidden sm:inline">{docs.length} payslip{docs.length === 1 ? '' : 's'}{skipped ? ` · ${skipped} could not be opened` : ''}</span>
        <button onClick={printAll} disabled={docs.length === 0}
          className="flex items-center gap-2 px-4 sm:px-5 py-2.5 sm:py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors">
          🖨️ Print / Save as PDF
        </button>
      </div>

      {docs.length === 0 ? (
        <div className="min-h-screen flex items-center justify-center text-sm text-gray-500 pt-16">No payslips could be opened.</div>
      ) : (
        <div className="ps-stack">
          {docs.map(d => (
            <div className="ps-sheet" key={d.id}><PayslipDocument entry={d.entry} adjustments={d.adjustments} /></div>
          ))}
        </div>
      )}

      <style jsx global>{`
        @media screen {
          body { background: #e5e7eb; }
          .ps-stack { display: flex; flex-direction: column; align-items: center; gap: 20px; padding: 20px; padding-top: 68px; }
          .ps-doc { background: white; width: 210mm; min-height: 150mm; padding: 16mm; box-shadow: 0 4px 24px rgba(0,0,0,0.15); }
        }
        @media print {
          @page { margin: 12mm 14mm; size: A4; }
          body { background: white !important; }
          .no-print { display: none !important; }
          .ps-stack { padding: 0 !important; display: block !important; }
          .ps-sheet { break-after: page; page-break-after: always; }
          .ps-sheet:last-child { break-after: auto; page-break-after: auto; }
          .ps-doc { box-shadow: none !important; width: 100% !important; padding: 0 !important; }
          .ps-net-pay, .ps-panel-head { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
        @media screen and (max-width: 640px) {
          .ps-stack { padding: 8px !important; padding-top: 60px !important; }
          .ps-doc { width: 100%; min-width: 0; min-height: 0; padding: 14px; }
        }
      `}</style>
    </>
  );
}
