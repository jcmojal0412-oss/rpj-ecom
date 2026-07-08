'use client';

import { useRef, useState } from 'react';
import { Camera, Loader2, CheckCircle2, AlertCircle, AlertTriangle, X, Plus, Link } from 'lucide-react';
import { formatCurrency, todayISO } from '@/lib/utils';
import { scanReceipt, normalizeDateToISO } from '@/lib/scan-receipt';

interface PO {
  id: number;
  po_number: string;
  supplier: string;
  total_amount: number;
  paid_amount: number;
  status: string;
  payment_notes: string | null;
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
    supplier_name: string | null;
    description: string | null;
  };
  matchedPo?: PO;       // existing PO match
  newPoId?: number;     // newly created PO id
  poNumber?: string;    // PO number (new or matched)
  duplicateOf?: { po_number: string; amount: number }; // same reference no already recorded
  amount: string;
  date: string;
  notes: string;
  saved: boolean;
}

// Pulls the digits/code out of a "Ref: 123456" style note for comparison.
function extractRefNo(notes: string | null): string | null {
  if (!notes) return null;
  const m = notes.match(/Ref:\s*(\S+)/i);
  return m ? m[1].trim() : null;
}

function findDuplicateRef(refNo: string | null, pos: PO[]): PO | null {
  if (!refNo) return null;
  return pos.find(po => extractRefNo(po.payment_notes) === refNo) ?? null;
}

function bestMatch(supplierName: string | null, pos: PO[]): PO | null {
  if (!supplierName || !pos.length) return null;
  const needle = supplierName.toLowerCase();
  // Only match POs that still have an outstanding balance — a fully paid or
  // cancelled PO is a closed transaction, so a new receipt from the same
  // supplier must start a new PO instead of overwriting the old payment.
  const open = pos.filter(po => po.status !== 'cancelled' && po.paid_amount < po.total_amount);
  for (const po of open) {
    if (po.supplier.toLowerCase().includes(needle) || needle.includes(po.supplier.toLowerCase())) {
      return po;
    }
  }
  return null;
}

function generatePoNumber(): string {
  const now = new Date();
  const y  = now.getFullYear().toString().slice(-2);
  const m  = String(now.getMonth() + 1).padStart(2, '0');
  const d  = String(now.getDate()).padStart(2, '0');
  const rnd = Math.floor(Math.random() * 900 + 100);
  return `PO-${y}${m}${d}-${rnd}`;
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

  // Mutable, synchronously-updated mirror of `pos` — reading/writing this
  // (instead of the `pos` prop) means two receipts scanned together in the
  // same batch see each other's just-created/just-matched PO immediately,
  // instead of racing against the same stale snapshot.
  const posRef = useRef<PO[]>(pos);

  const update = (i: number, patch: Partial<ScanResult>) =>
    setItems(prev => prev.map((it, idx) => idx === i ? { ...it, ...patch } : it));

  const handleFiles = async (files: FileList) => {
    const newItems: ScanResult[] = Array.from(files).map(file => ({
      file,
      previewUrl: URL.createObjectURL(file),
      status: 'scanning',
      amount: '',
      date: todayISO(),
      notes: '',
      saved: false,
    }));
    setItems(prev => [...prev, ...newItems]);
    const offset = items.length;

    await Promise.all(newItems.map(async (item, j) => {
      const i = offset + j;
      try {
        const e = await scanReceipt(item.file);
        const date = normalizeDateToISO(e.date) || todayISO();
        const notes = e.reference_no ? `Ref: ${e.reference_no}` : '';

        // Everything from here to the point we claim/create is synchronous —
        // no `await` runs in between — so a second receipt in the same batch
        // can't interleave and miss what this one is about to do.
        const dup = findDuplicateRef(e.reference_no, posRef.current);
        const matched = !dup ? bestMatch(e.supplier_name, posRef.current) : null;

        if (dup) {
          // Same reference number already recorded on another PO — flag it
          // and let the user confirm instead of auto-saving/auto-creating.
          update(i, {
            status: 'done',
            extracted: e,
            matchedPo: matched ?? undefined,
            duplicateOf: { po_number: dup.po_number, amount: dup.total_amount },
            poNumber: matched?.po_number,
            amount: e.amount != null ? String(e.amount) : '',
            date,
            notes,
          });
        } else if (matched) {
          update(i, {
            status: 'done',
            extracted: e,
            matchedPo: matched,
            poNumber: matched.po_number,
            amount: e.amount != null ? String(e.amount) : '',
            date,
            notes,
          });
        } else {
          // Auto-create a new PO. Claim the reference number in posRef
          // synchronously, before the network call, so a duplicate receipt
          // scanned in the same batch sees this one and gets flagged
          // instead of also auto-creating.
          const po_number = generatePoNumber();
          const supplier  = e.supplier_name || 'Unknown Supplier';
          const amount    = e.amount ?? 0;
          const claim: PO = {
            id: -1, po_number, supplier, total_amount: amount, paid_amount: amount,
            status: 'received', payment_notes: notes || null,
          };
          posRef.current = [...posRef.current, claim];

          const res = await fetch('/api/purchase-orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              po_number,
              supplier,
              total_amount: amount,
              paid_amount:  amount,
              payment_date: date || null,
              payment_notes: notes || null,
              status: 'received',
              ordered_at: date,
            }),
          });

          if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            throw new Error('Auto-create PO failed: ' + (d.error || res.status));
          }

          const { id: newPoId } = await res.json();
          posRef.current = posRef.current.map(p => p === claim ? { ...p, id: newPoId } : p);
          update(i, {
            status: 'done',
            extracted: e,
            newPoId,
            poNumber: po_number,
            amount: String(amount),
            date,
            notes,
            saved: true, // already saved during creation
          });
        }
      } catch (err: any) {
        update(i, { status: 'error', error: err.message || 'Scan failed' });
      }
    }));
  };

  // User has reviewed a flagged duplicate-reference item and confirmed it's
  // a genuine separate transaction — proceed with the normal save/create.
  const saveDuplicateAnyway = async (i: number) => {
    const item = items[i];
    if (!item.amount) return;
    setSaving(i);
    try {
      if (item.matchedPo) {
        const res = await fetch(`/api/purchase-orders/${item.matchedPo.id}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            paid_amount:   item.matchedPo.paid_amount + parseFloat(item.amount),
            payment_date:  item.date || null,
            payment_notes: item.notes || null,
          }),
        });
        if (res.ok) {
          update(i, { saved: true });
          setItems(prev => {
            if (prev.every((it, idx) => idx === i ? true : it.saved)) onAllSaved();
            return prev;
          });
        }
      } else {
        const po_number = generatePoNumber();
        const amount = parseFloat(item.amount);
        const res = await fetch('/api/purchase-orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            po_number,
            supplier: item.extracted?.supplier_name || 'Unknown Supplier',
            total_amount: amount,
            paid_amount:  amount,
            payment_date: item.date || null,
            payment_notes: item.notes || null,
            status: 'received',
            ordered_at: item.date,
          }),
        });
        if (res.ok) {
          const { id: newPoId } = await res.json();
          update(i, { newPoId, poNumber: po_number, saved: true });
          setItems(prev => {
            if (prev.every((it, idx) => idx === i ? true : it.saved)) onAllSaved();
            return prev;
          });
        }
      }
    } finally {
      setSaving(null);
    }
  };

  const saveMatched = async (i: number) => {
    const item = items[i];
    if (!item.matchedPo || !item.amount) return;
    setSaving(i);
    try {
      const res = await fetch(`/api/purchase-orders/${item.matchedPo.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          // Add to whatever was already paid — this receipt is one more
          // payment toward the PO, not the PO's full paid total.
          paid_amount:   item.matchedPo.paid_amount + parseFloat(item.amount),
          payment_date:  item.date || null,
          payment_notes: item.notes || null,
        }),
      });
      if (res.ok) {
        update(i, { saved: true });
        setItems(prev => {
          if (prev.every((it, idx) => idx === i ? true : it.saved)) onAllSaved();
          return prev;
        });
      }
    } finally {
      setSaving(null);
    }
  };

  const saveAll = async () => {
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.saved && it.status === 'done' && it.matchedPo && it.amount && !it.duplicateOf) {
        await saveMatched(i);
      }
    }
    onAllSaved();
  };

  const pendingMatchCount = items.filter(it => it.status === 'done' && it.matchedPo && !it.duplicateOf && !it.saved).length;

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
            <div key={i} className={`border rounded-xl p-3 space-y-2 ${
              item.saved ? 'border-green-200 bg-green-50/30' : 'border-gray-200 bg-white'
            }`}>
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

                  {item.status === 'done' && (
                    <div className="text-xs mt-0.5 space-y-0.5">
                      {item.extracted?.supplier_name && (
                        <p className="text-gray-600">
                          Supplier: <b className="text-gray-800">{item.extracted.supplier_name}</b>
                        </p>
                      )}
                      {item.extracted?.amount != null && (
                        <p className="text-gray-600">
                          Amount: <b className="text-gray-800">{formatCurrency(item.extracted.amount)}</b>
                        </p>
                      )}
                      {/* Duplicate reference warning */}
                      {item.duplicateOf && !item.saved && (
                        <div className="flex items-center gap-1 text-red-600 font-semibold">
                          <AlertTriangle size={10} /> Possible duplicate — same Ref already on {item.duplicateOf.po_number} ({formatCurrency(item.duplicateOf.amount)})
                        </div>
                      )}
                      {/* Match indicator */}
                      {item.matchedPo && !item.saved && (
                        <div className="flex items-center gap-1 text-blue-600 font-medium">
                          <Link size={10} /> Matched to {item.matchedPo.po_number}
                        </div>
                      )}
                      {item.newPoId && (
                        <div className="flex items-center gap-1 text-green-600 font-medium">
                          <Plus size={10} /> New PO created: {item.poNumber}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <button
                  onClick={() => setItems(prev => prev.filter((_, idx) => idx !== i))}
                  className="text-gray-300 hover:text-red-400 shrink-0"
                >
                  <X size={14} />
                </button>
              </div>

              {/* Editable fields for matched PO or flagged duplicate (not yet saved) */}
              {item.status === 'done' && (item.matchedPo || item.duplicateOf) && !item.saved && (
                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-gray-100">
                  <div>
                    <label className="block text-[10px] font-medium text-gray-500 mb-0.5">Amount (₱)</label>
                    <input
                      type="number"
                      className="form-input text-sm py-1.5"
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
                    <label className="block text-[10px] font-medium text-gray-500 mb-0.5">Notes</label>
                    <input
                      type="text"
                      className="form-input text-sm py-1.5"
                      value={item.notes}
                      onChange={e => update(i, { notes: e.target.value })}
                    />
                  </div>
                  <div className="col-span-2 flex justify-end gap-2">
                    {item.duplicateOf && (
                      <button
                        onClick={() => setItems(prev => prev.filter((_, idx) => idx !== i))}
                        disabled={saving === i}
                        className="btn-secondary text-xs py-1.5 disabled:opacity-50"
                      >
                        Discard (it's a duplicate)
                      </button>
                    )}
                    <button
                      onClick={() => item.duplicateOf ? saveDuplicateAnyway(i) : saveMatched(i)}
                      disabled={saving === i || !item.amount}
                      className="btn-primary text-xs py-1.5 disabled:opacity-50"
                    >
                      {saving === i ? <Loader2 size={12} className="animate-spin inline mr-1" /> : null}
                      {saving === i ? 'Saving...' : item.duplicateOf ? 'Not a duplicate — Save' : 'Save Payment'}
                    </button>
                  </div>
                </div>
              )}

              {item.saved && (
                <div className="flex items-center gap-2 text-xs text-green-700 pt-1 border-t border-green-100">
                  <CheckCircle2 size={14} />
                  {item.newPoId
                    ? `New PO ${item.poNumber} created & paid — ${formatCurrency(parseFloat(item.amount || '0'))}`
                    : `Payment saved to ${item.poNumber} — ${formatCurrency(parseFloat(item.amount || '0'))}`
                  }
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {pendingMatchCount > 1 && (
        <button onClick={saveAll} className="btn-primary w-full justify-center">
          Save All {pendingMatchCount} Payments
        </button>
      )}

      <div className="flex justify-end">
        <button onClick={onClose} className="btn-secondary">Close</button>
      </div>
    </div>
  );
}
