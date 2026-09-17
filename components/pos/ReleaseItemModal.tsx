'use client';

import { useMemo, useState } from 'react';
import { CheckCircle2, PackageCheck } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { displayReceiptNo, derivePaymentStatus, type Sale, type SaleItem, type Refund } from './constants';

interface Props {
  sale: Sale;
  items: SaleItem[];
  refunds: Refund[];
  onCancel: () => void;
  onReleased: () => void;
}

interface LineInput { serial_number: string; imei_1: string; imei_2: string; }

export default function ReleaseItemModal({ sale, items, refunds, onCancel, onReleased }: Props) {
  // Same remaining-after-refund computation the refund/void routes already
  // use server-side — shown here so the cashier isn't asked to fill in
  // serial/IMEI for units the customer no longer owns.
  const alreadyRefunded = useMemo(() => {
    const map = new Map<number, number>();
    for (const r of refunds) for (const it of r.items) map.set(it.sale_item_id, (map.get(it.sale_item_id) ?? 0) + it.quantity);
    return map;
  }, [refunds]);

  const releaseLines = items
    .filter(it => it.product_id != null)
    .map(it => ({ ...it, remaining: it.quantity - (alreadyRefunded.get(it.id) ?? 0) }))
    .filter(it => it.remaining > 0);

  const [lineInputs, setLineInputs] = useState<Record<number, LineInput>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const setInput = (itemId: number, patch: Partial<LineInput>) => {
    setLineInputs(prev => {
      const current = prev[itemId] ?? { serial_number: '', imei_1: '', imei_2: '' };
      return { ...prev, [itemId]: { ...current, ...patch } };
    });
  };

  const paymentStatus = derivePaymentStatus(sale);
  const financingBlocked = !!sale.financing_provider && sale.financing_approval_status !== 'Approved';

  const submit = async () => {
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch(`/api/pos/sales/${sale.id}/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: releaseLines.map(it => ({ sale_item_id: it.id, ...lineInputs[it.id] })),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to release item'); return; }
      setDone(true);
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="space-y-4 text-center py-4">
        <div className="flex items-center gap-2 justify-center text-green-600">
          <CheckCircle2 size={20} />
          <p className="text-sm font-bold">ITEM RELEASED</p>
        </div>
        <p className="text-xs text-gray-500">{displayReceiptNo(sale)} — {sale.customer_name}</p>
        <button onClick={onReleased} className="btn-primary">Done</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}

      <div className="bg-gray-50 rounded-lg p-3 space-y-1 text-sm">
        <div className="flex justify-between"><span className="text-gray-500">Transaction</span><span className="font-semibold">{displayReceiptNo(sale)}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">Customer</span><span className="font-medium">{sale.customer_name}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">Mobile</span><span className="font-medium">{sale.customer_mobile}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">Amount Paid</span><span className="font-medium tabular-nums">{formatCurrency(sale.total)}</span></div>
        {sale.financing_provider && (
          <div className="flex justify-between"><span className="text-gray-500">Financing</span><span className="font-medium">{sale.financing_provider}</span></div>
        )}
        <div className="flex justify-between"><span className="text-gray-500">Payment Status</span><span className="font-semibold">{paymentStatus}</span></div>
        <div className="flex justify-between"><span className="text-gray-500">Fulfillment Status</span><span className="font-semibold">{sale.fulfillment_status}</span></div>
      </div>

      {financingBlocked && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-3">
          Cannot release item. Financing is not yet approved.
        </div>
      )}

      <div className="space-y-3">
        <p className="text-xs font-semibold text-gray-600">Serial / IMEI (optional — for serialized items like phones, tablets, laptops)</p>
        {releaseLines.map(it => (
          <div key={it.id} className="border border-gray-100 rounded-lg p-3">
            <p className="text-sm font-medium text-gray-800">{it.product_name} <span className="text-xs text-gray-400 font-normal">× {it.remaining}</span></p>
            <div className="grid grid-cols-3 gap-2 mt-2">
              <input className="form-input py-1.5 text-xs" placeholder="Serial No." value={lineInputs[it.id]?.serial_number ?? ''} onChange={e => setInput(it.id, { serial_number: e.target.value })} />
              <input className="form-input py-1.5 text-xs" placeholder="IMEI 1" value={lineInputs[it.id]?.imei_1 ?? ''} onChange={e => setInput(it.id, { imei_1: e.target.value })} />
              <input className="form-input py-1.5 text-xs" placeholder="IMEI 2" value={lineInputs[it.id]?.imei_2 ?? ''} onChange={e => setInput(it.id, { imei_2: e.target.value })} />
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button onClick={onCancel} disabled={submitting} className="btn-secondary">Cancel</button>
        <button onClick={submit} disabled={submitting || financingBlocked} className="btn-primary disabled:opacity-50">
          <PackageCheck size={15} /> {submitting ? 'Releasing...' : 'Confirm Release'}
        </button>
      </div>
    </div>
  );
}
