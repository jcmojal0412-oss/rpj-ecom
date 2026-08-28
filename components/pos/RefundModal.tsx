'use client';

import { useMemo, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import type { Sale, SaleItem, Refund } from './constants';

interface Props {
  sale: Sale;
  items: SaleItem[];
  refunds: Refund[];
  onCancel: () => void;
  onRefunded: () => void;
}

export default function RefundModal({ sale, items, refunds, onCancel, onRefunded }: Props) {
  const alreadyRefunded = useMemo(() => {
    const map = new Map<number, number>();
    for (const r of refunds) {
      for (const it of r.items) {
        map.set(it.sale_item_id, (map.get(it.sale_item_id) ?? 0) + it.quantity);
      }
    }
    return map;
  }, [refunds]);

  const refundableItems = items.map(it => ({
    ...it,
    remaining: it.quantity - (alreadyRefunded.get(it.id) ?? 0),
  }));

  const [qtyMap, setQtyMap] = useState<Record<number, number>>({});
  const [conditionMap, setConditionMap] = useState<Record<number, 'Sellable' | 'Defective'>>({});
  const [reason, setReason] = useState('');
  const [refundMethod, setRefundMethod] = useState('Cash');
  const [freebiesReturned, setFreebiesReturned] = useState<'YES' | 'NO' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const hasFreebies = items.some(it => !!it.is_freebie);

  const setQty = (itemId: number, qty: number, max: number) => {
    setQtyMap(prev => ({ ...prev, [itemId]: Math.max(0, Math.min(qty, max)) }));
  };

  const total = refundableItems.reduce((s, it) => s + (qtyMap[it.id] ?? 0) * it.unit_price, 0);
  const hasSelection = Object.values(qtyMap).some(q => q > 0);

  const submit = async () => {
    setError('');
    const payloadItems = refundableItems
      .filter(it => (qtyMap[it.id] ?? 0) > 0)
      .map(it => ({ sale_item_id: it.id, quantity: qtyMap[it.id], condition: conditionMap[it.id] ?? 'Sellable' }));
    if (payloadItems.length === 0) return;

    setSubmitting(true);
    try {
      const res = await fetch(`/api/pos/sales/${sale.id}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: payloadItems, reason, refund_method: refundMethod,
          freebies_returned: hasFreebies ? freebiesReturned : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to process refund'); return; }
      onRefunded();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}

      <div className="space-y-2">
        {refundableItems.map(it => (
          <div key={it.id} className={`py-2 border-b border-gray-50 ${it.remaining <= 0 ? 'opacity-40' : ''}`}>
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-800 truncate">{it.product_name}</p>
                <p className="text-xs text-gray-400">{formatCurrency(it.unit_price)} each · sold {it.quantity} · {it.remaining} refundable</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button type="button" disabled={it.remaining <= 0} onClick={() => setQty(it.id, (qtyMap[it.id] ?? 0) - 1, it.remaining)}
                  className="p-1 rounded hover:bg-gray-100 text-gray-500 disabled:opacity-30"><Minus size={12} /></button>
                <span className="text-sm font-semibold w-6 text-center tabular-nums">{qtyMap[it.id] ?? 0}</span>
                <button type="button" disabled={it.remaining <= 0} onClick={() => setQty(it.id, (qtyMap[it.id] ?? 0) + 1, it.remaining)}
                  className="p-1 rounded hover:bg-gray-100 text-gray-500 disabled:opacity-30"><Plus size={12} /></button>
              </div>
            </div>
            {(qtyMap[it.id] ?? 0) > 0 && (
              <div className="flex items-center gap-1.5 mt-1.5">
                <span className="text-[10px] text-gray-400">Condition:</span>
                {(['Sellable', 'Defective'] as const).map(c => (
                  <button key={c} type="button" onClick={() => setConditionMap(prev => ({ ...prev, [it.id]: c }))}
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${(conditionMap[it.id] ?? 'Sellable') === c ? (c === 'Sellable' ? 'bg-green-50 border-green-400 text-green-700' : 'bg-amber-50 border-amber-400 text-amber-700') : 'bg-white border-gray-200 text-gray-500'}`}>
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {hasFreebies && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <p className="text-xs font-medium text-amber-800">This sale included a promo freebie. Were the freebie item(s) also returned?</p>
          <div className="flex gap-2 mt-2">
            {(['YES', 'NO'] as const).map(v => (
              <button key={v} type="button" onClick={() => setFreebiesReturned(v)}
                className={`px-3 py-1 rounded-md text-xs font-semibold border ${freebiesReturned === v ? 'bg-amber-500 border-amber-500 text-white' : 'bg-white border-amber-300 text-amber-700'}`}>
                {v}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <label className="form-label">Reason (Optional)</label>
        <input className="form-input" placeholder="e.g. Defective item, wrong size" value={reason} onChange={e => setReason(e.target.value)} />
      </div>

      <div>
        <label className="form-label">Refund Via</label>
        <div className="grid grid-cols-3 gap-1.5">
          {['Cash', 'GCash', 'Maya', 'Sodexo', 'Bank Transfer', 'Credit Card'].map(m => (
            <button key={m} type="button" onClick={() => setRefundMethod(m)}
              className={`px-2 py-1.5 rounded-md text-xs font-semibold border transition-all ${refundMethod === m ? 'bg-blue-50 border-blue-400 text-blue-700' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
              {m}
            </button>
          ))}
        </div>
      </div>

      <div className="flex justify-between items-center bg-gray-50 rounded-lg px-4 py-3">
        <span className="text-sm font-medium text-gray-600">Refund Total</span>
        <span className="text-lg font-bold text-gray-900 tabular-nums">{formatCurrency(total)}</span>
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button onClick={onCancel} disabled={submitting} className="btn-secondary">Cancel</button>
        <button onClick={submit} disabled={submitting || !hasSelection} className="btn-danger disabled:opacity-50">
          {submitting ? 'Processing...' : 'Refund Selected Items'}
        </button>
      </div>
    </div>
  );
}
