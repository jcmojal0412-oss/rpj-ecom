'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Image from 'next/image';

interface POItem {
  id: number; name: string; sku: string; quantity: number; unit_cost: number;
}
interface PO {
  id: number; po_number: string; supplier: string; total_amount: number;
  status: string; ordered_at: string; notes: string; items: POItem[];
}

const COMPANY = {
  name:     'RPJ CORPORATION - BODEGA NI SUKI',
  address1: '426A Bulalakaw St Plainview',
  address2: 'Mandaluyong City MM',
  contact:  'Viber: 09064034136',
  preparedBy: 'JOHN CHRISTIAN MOJAL',
  preparedTitle: 'SALES & MARKETING MANAGER',
  approvedBy: 'RODELYN C. MOJAL',
  approvedTitle: 'OWNER',
};

const NOTES = [
  'No PO No delivery policy shall be followed by the vendors.',
  'PO is in accordance with the description, specification, qty, prices and payment terms listed above.',
  'All original supporting documents should be attached and submitted by vendor in accordance to PO.',
  'All deliveries should be coordinated to Purchasing Officer and PO must be signed by Owner c/ Ms. Rodelyn C. Mojal',
];

function fmt(n: number) {
  return n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(d: string) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-PH', { month: '2-digit', day: '2-digit', year: 'numeric' });
}

export default function POPrintPage() {
  const params = useParams();
  const [po, setPo] = useState<PO | null>(null);

  useEffect(() => {
    fetch(`/api/purchase-orders/${params.id}`)
      .then(r => r.json()).then(setPo);
  }, [params.id]);

  if (!po) return (
    <div className="flex items-center justify-center h-screen text-gray-500">
      Loading PO...
    </div>
  );

  const subtotal = po.items.reduce((s, i) => s + i.quantity * i.unit_cost, 0);

  return (
    <>
      {/* Print controls — hidden when printing */}
      <div className="no-print fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-3 bg-gray-900 text-white shadow-xl">
        <div className="flex items-center gap-4">
          <button
            onClick={() => window.history.back()}
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            ← Back
          </button>
          <span className="text-sm text-gray-300">PO #{po.po_number}</span>
        </div>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 px-5 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          🖨️ Print / Save as PDF
        </button>
      </div>

      {/* PO Document */}
      <div className="po-page" style={{ paddingTop: '60px' }}>
        <div className="po-doc">

          {/* ── HEADER ── */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
            {/* Left: Logo + Company */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
              <img src="/logo.png" alt="RPJ Corp" style={{ width: '70px', height: '70px', objectFit: 'contain' }} />
              <div>
                <div style={{ fontWeight: 900, fontSize: '16px', color: '#1a1a2e' }}>{COMPANY.name}</div>
                <div style={{ fontSize: '11px', color: '#444', marginTop: '2px' }}>{COMPANY.address1}</div>
                <div style={{ fontSize: '11px', color: '#444' }}>{COMPANY.address2}</div>
                <div style={{ fontSize: '11px', color: '#444' }}>{COMPANY.contact}</div>
              </div>
            </div>

            {/* Right: PURCHASE ORDER title + date/po# */}
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '28px', fontWeight: 900, color: '#1a1a2e', letterSpacing: '1px' }}>
                PURCHASE ORDER
              </div>
              <table style={{ marginLeft: 'auto', marginTop: '8px', borderCollapse: 'collapse', fontSize: '12px' }}>
                <tbody>
                  <tr>
                    <td style={{ padding: '3px 8px', fontWeight: 700, background: '#f3f4f6', border: '1px solid #d1d5db' }}>DATE</td>
                    <td style={{ padding: '3px 12px', border: '1px solid #d1d5db', minWidth: '100px' }}>{fmtDate(po.ordered_at)}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '3px 8px', fontWeight: 700, background: '#f3f4f6', border: '1px solid #d1d5db' }}>PO #</td>
                    <td style={{ padding: '3px 12px', border: '1px solid #d1d5db', fontWeight: 700 }}>{po.po_number}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* ── VENDOR ── */}
          <div style={{ border: '1px solid #d1d5db', marginBottom: '14px' }}>
            <div style={{ background: '#1e3a5f', color: 'white', padding: '4px 10px', fontSize: '12px', fontWeight: 700 }}>
              VENDOR
            </div>
            <div style={{ padding: '10px 12px' }}>
              <div style={{ fontWeight: 700, fontSize: '13px' }}>{po.supplier}</div>
              {po.notes && <div style={{ fontSize: '11px', color: '#555', marginTop: '4px' }}>{po.notes}</div>}
            </div>
          </div>

          {/* Terms */}
          <div style={{ fontSize: '12px', marginBottom: '14px' }}>
            <strong>Terms of Payment:</strong>&nbsp; Terms with PDC
          </div>

          {/* ── ITEMS TABLE ── */}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', marginBottom: '0' }}>
            <thead>
              <tr style={{ background: '#1e3a5f', color: 'white' }}>
                <th style={{ padding: '6px 10px', textAlign: 'center', width: '50px' }}>ITEM #</th>
                <th style={{ padding: '6px 10px', textAlign: 'left' }}>DESCRIPTION</th>
                <th style={{ padding: '6px 10px', textAlign: 'center', width: '60px' }}>QTY</th>
                <th style={{ padding: '6px 10px', textAlign: 'right', width: '110px' }}>UNIT PRICE</th>
                <th style={{ padding: '6px 10px', textAlign: 'right', width: '110px' }}>TOTAL</th>
              </tr>
            </thead>
            <tbody>
              {po.items.map((item, i) => (
                <tr key={item.id} style={{ background: i % 2 === 0 ? '#ffffff' : '#f9fafb' }}>
                  <td style={{ padding: '5px 10px', textAlign: 'center', border: '1px solid #e5e7eb' }}>{i + 1}</td>
                  <td style={{ padding: '5px 10px', border: '1px solid #e5e7eb' }}>{item.name}</td>
                  <td style={{ padding: '5px 10px', textAlign: 'center', border: '1px solid #e5e7eb' }}>{item.quantity}</td>
                  <td style={{ padding: '5px 10px', textAlign: 'right', border: '1px solid #e5e7eb' }}>{fmt(item.unit_cost)}</td>
                  <td style={{ padding: '5px 10px', textAlign: 'right', border: '1px solid #e5e7eb' }}>{fmt(item.quantity * item.unit_cost)}</td>
                </tr>
              ))}
              {/* Empty rows to fill space */}
              {Array.from({ length: Math.max(0, 15 - po.items.length) }).map((_, i) => (
                <tr key={`empty-${i}`} style={{ height: '22px', background: (po.items.length + i) % 2 === 0 ? '#ffffff' : '#f9fafb' }}>
                  <td style={{ border: '1px solid #e5e7eb' }}>&nbsp;</td>
                  <td style={{ border: '1px solid #e5e7eb' }}></td>
                  <td style={{ border: '1px solid #e5e7eb' }}></td>
                  <td style={{ border: '1px solid #e5e7eb', textAlign: 'right', color: '#aaa' }}>{i < 3 ? '-' : ''}</td>
                  <td style={{ border: '1px solid #e5e7eb', textAlign: 'right', color: '#aaa' }}>{i < 3 ? '-' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* ── TOTALS ── */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '14px' }}>
            <table style={{ fontSize: '12px', borderCollapse: 'collapse', minWidth: '220px' }}>
              <tbody>
                {[
                  ['SUBTOTAL', fmt(subtotal)],
                  ['TAX', '-'],
                  ['SHIPPING', '-'],
                  ['OTHER', '-'],
                ].map(([label, value]) => (
                  <tr key={label}>
                    <td style={{ padding: '4px 12px', border: '1px solid #e5e7eb', background: '#f9fafb', fontWeight: 600 }}>{label}</td>
                    <td style={{ padding: '4px 16px', border: '1px solid #e5e7eb', textAlign: 'right', minWidth: '100px' }}>{value}</td>
                  </tr>
                ))}
                <tr>
                  <td style={{ padding: '5px 12px', border: '2px solid #1e3a5f', background: '#1e3a5f', color: 'white', fontWeight: 700 }}>TOTAL</td>
                  <td style={{ padding: '5px 16px', border: '2px solid #1e3a5f', textAlign: 'right', fontWeight: 700, fontSize: '13px' }}>
                    PHP {fmt(subtotal)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* ── NOTES + SIGNATURES ── */}
          <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-end' }}>
            {/* Notes */}
            <div style={{ flex: 1, border: '1px solid #d1d5db', padding: '10px', fontSize: '10.5px' }}>
              <div style={{ fontWeight: 700, marginBottom: '6px' }}>NOTE:</div>
              {NOTES.map((note, i) => (
                <div key={i} style={{ marginBottom: '4px' }}>{i + 1}. {note}</div>
              ))}
            </div>

            {/* Signatures */}
            <div style={{ minWidth: '360px' }}>
              <div style={{ display: 'flex', gap: '24px' }}>
                {/* John's signature */}
                <div style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ height: '70px', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', marginBottom: '0' }}>
                    <img
                      src="/sig-john.png"
                      alt="Signature"
                      style={{ maxHeight: '65px', maxWidth: '140px', objectFit: 'contain', mixBlendMode: 'multiply' }}
                    />
                  </div>
                  <div style={{ borderTop: '1.5px solid #333', paddingTop: '4px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 700 }}>PREPARED BY: {COMPANY.preparedBy}</div>
                    <div style={{ fontSize: '10px', color: '#555' }}>{COMPANY.preparedTitle}</div>
                  </div>
                </div>

                {/* Rodelyn's signature */}
                <div style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ height: '70px', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', marginBottom: '0' }}>
                    <img
                      src="/sig-rodelyn.png"
                      alt="Signature"
                      style={{ maxHeight: '65px', maxWidth: '140px', objectFit: 'contain', mixBlendMode: 'multiply' }}
                    />
                  </div>
                  <div style={{ borderTop: '1.5px solid #333', paddingTop: '4px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 700 }}>APPROVED BY: {COMPANY.approvedBy}</div>
                    <div style={{ fontSize: '10px', color: '#555' }}>{COMPANY.approvedTitle}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>

      <style jsx global>{`
        @media screen {
          body { background: #e5e7eb; }
          .po-page { min-height: 100vh; display: flex; justify-content: center; padding: 20px; }
          .po-doc { background: white; width: 210mm; min-height: 297mm; padding: 18mm 16mm; box-shadow: 0 4px 24px rgba(0,0,0,0.15); }
        }
        @media print {
          @page { margin: 12mm 14mm; size: A4; }
          body { background: white !important; }
          .no-print { display: none !important; }
          .po-page { padding: 0 !important; }
          .po-doc { box-shadow: none !important; width: 100% !important; padding: 0 !important; }
        }
      `}</style>
    </>
  );
}
