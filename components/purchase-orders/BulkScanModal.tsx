'use client';

import { useRef, useState } from 'react';
import { Camera, Loader2, CheckCircle2, AlertCircle, X, ChevronDown } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { scanReceipt, normalizeDateToISO } from '@/lib/scan-receipt';

interface PO {
  id: number;
  po_number: string;
  supplier: string;
  total_amount: number;
  paid_amount: number;
}

interface ScanResult {
  file: File;
  previewUrl: string;
  status: 'scanning' | 'done' | 'error';
  error?: string;
  extracted?: {
    date: string | null;
    amount: number | null;
    reference_no: string | null;
    bank_from: string | null;
    bank_to: string | null;
    supplier_name: string | null;
    description: string | null;
  };
  matchedPoId: number | '';
  // editable fields
  amount: string;
  date: string;
  notes: string;
  saved: boolean;
}

function bestMatch(supplierName: string | null, pos: PO[]): number | '' {
  if (!supplierName || !pos.length) return '';
  const needle = supplierName.toLowerCase();
  for (const po of pos) {
    if (po.supplier.toLowerCase().includes(needle) || needle.includes(po.supplier.toLowerCase())) {
      return po.id;
    }
  }
  return '';
}

export default function BulkScanModal({
  pos,
  onClose,
  onAllSaved,
}: {
  pos: PO[];
  onClose: () => void;
  onAllSaved: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<ScanResult[]>([]);
  const [saving, setSaving] = useState<number | null>(null);

  const update = (i: number, patch: Partial<ScanResult>) =>
    setItems(prev => prev.map((it, idx) => idx === i ? { ...it, ...patch } : it));

  const handleFiles = async (files: FileList) => {
    const newItems: ScanResult[] = Array.from(files).map(file => ({
      file,
      previewUrl: URL.createObjectURL(file),
      status: 'scanning',
      matchedPoId: '',
      amount: '',
      date: new Date().toISOString().slice(0, 10),
      notes: '',
      saved: false,
    }));
    setItems(prev => [...prev, ...newItems]);
    const offset = items.length;

    // scan all in parallel
    await Promise.all(newItems.map(async (item, j) => {
      const i = offset + j;
      try {
        const e = await scanReceipt(item.file);
        const matched = bestMatch(e.supplier_name, pos);
        update(i, {
          status: 'done',
          extracted: e,
          matchedPoId: matched,
          amount: e.amount != null ? String(e.amount) : '',
          date: normalizeDateToISO(e.date) || new Date().toISOString().slice(0, 10),
          notes: e.reference_no ? `Ref: ${e.reference_no}` : '',
        });
      } catch (err: any) {
        update(i, { status: 'error', error: err.message || 'Scan failed' });
      }
    }));
  };

  const saveOne = async (i: number) => {
    const item = items[i];
    if (!item.amount || !item.matchedPoId) return;
    setSaving(i);
    try {
      const res = await fetch(`/api/purchase-orders/${item.matchedPoId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          paid_amount:   parseFloat(item.amount),
          payment_date:  item.date || null,
          payment_notes: item.notes || null,
        }),
      });
      if (res.ok) {
        update(i, { saved: true });
        if (items.every((it, idx) => idx === i || it.saved)) onAllSaved();
      }
    } finally {
      setSaving(null);
    }
  };

  const saveAll = async () => {
    for (let i = 0; i < items.length; i++) {
      if (!items[i].saved && items[i].status === 'done' && items[i].amount && items[i].matchedPoId) {
        await saveOne(i);
      }
    }
    onAllSaved();
  };

  const readyCount = items.filter(it => it.status === 'done' && it.amount && it.matchedPoId && !it.saved).length;

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        onClick={() => fileRef.current?.click()}
        className="border-2 border-dashed border-orange-300 rounded-xl p-6 text-center cursor-pointer hover:bg-orange-50/40 transition-colors"
      >
        <Camera className="mx-auto text-orange-400 mb-2" size={28} />
        <p className="text-sm font-semibold text-gray-700">Upload Payment Screenshots</p>
        <p className="text-xs text-gray-400 mt-1">Pwedeng multiple — AI mag-re-read ng lahat</p>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={e => { if (e.target.files?.length) handleFiles(e.target.files); e.target.value = ''; }}
        />
      </div>

      {/* Results */}
      {items.length > 0 && (
        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          {items.map((item, i) => (
            <div key={i} className={`border rounded-xl p-3 space-y-3 ${item.saved ? 'border-green-200 bg-green-50/30' : 'border-gray-200 bg-white'}`}>
              <div className="flex items-start gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.previewUrl} alt="" className="w-16 h-16 object-cover rounded-lg border border-gray-100 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-600 truncate">{item.file.name}</p>
                  {item.status === 'scanning' && (
                    <div className="flex items-center gap-1.5 text-xs text-orange-500 mt-1">
                      <Loader2 size={12} className="animate-spin" /> Scanning...
                    </div>
                  )}
                  {item.status === 'error' && (
                    <div className="flex items-center gap-1.5 text-xs text-red-500 mt-1">
                      <AlertCircle size={12} /> {item.error}
                    </div>
                  )}
                  {item.status === 'done' && item.extracted && (
                    <div className="text-xs text-gray-500 mt-0.5 space-y-0.5">
                      {item.extracted.supplier_name && <p>Recipient: <b className="text-gray-700">{item.extracted.supplier_name}</b></p>}
                      {item.extracted.bank_from && <p>From: {item.extracted.bank_from}</p>}
                    </div>
                  )}
                </div>
                <button onClick={() => setItems(prev => prev.filter((_, idx) => idx !== i))} className="text-gray-300 hover:text-red-400 shrink-0">
                  <X size={14} />
                </button>
              </div>

              {item.status === 'done' && !item.saved && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-medium text-gray-500 mb-0.5">Amount (₱)</label>
                    <input
                      type="number"
                      className="form-input text-sm py-1.5"
                      placeholder="0.00"
                      value={item.amount}
                      onChange={e => update(i, { amount: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-gray-500 mb-0.5">Date</label>
                    <input
                      type="date"
                      className="form-input text-sm py-1.5"
                      value={item.date}
                      onChange={e => update(i, { date: e.target.value })}
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-[10px] font-medium text-gray-500 mb-0.5">Match to PO</label>
                    <div className="relative">
                      <select
                        className="form-input text-sm py-1.5 pr-8 appearance-none"
                        value={item.matchedPoId}
                        onChange={e => update(i, { matchedPoId: e.target.value ? Number(e.target.value) : '' })}
                      >
                        <option value="">— Select PO —</option>
                        {pos.map(po => (
                          <option key={po.id} value={po.id}>
                            {po.po_number} · {po.supplier} · {formatCurrency(po.total_amount)}
                          </option>
                        ))}
                      </select>
                      <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    </div>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-[10px] font-medium text-gray-500 mb-0.5">Notes</label>
                    <input
                      type="text"
                      className="form-input text-sm py-1.5"
                      placeholder="Ref number, bank, etc."
                      value={item.notes}
                      onChange={e => update(i, { notes: e.target.value })}
                    />
                  </div>
                  <div className="col-span-2 flex justify-end">
                    <button
                      onClick={() => saveOne(i)}
                      disabled={saving === i || !item.amount || !item.matchedPoId}
                      className="btn-primary text-xs py-1.5 disabled:opacity-50"
                    >
                      {saving === i ? <Loader2 size={12} className="animate-spin" /> : null}
                      {saving === i ? 'Saving...' : 'Save this payment'}
                    </button>
                  </div>
                </div>
              )}

              {item.saved && (
                <div className="flex items-center gap-2 text-xs text-green-700">
                  <CheckCircle2 size={14} /> Payment recorded — {formatCurrency(parseFloat(item.amount))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Save all button */}
      {readyCount > 1 && (
        <button onClick={saveAll} className="btn-primary w-full justify-center">
          Save All {readyCount} Payments
        </button>
      )}

      <div className="flex justify-end">
        <button onClick={onClose} className="btn-secondary">Close</button>
      </div>
    </div>
  );
}
