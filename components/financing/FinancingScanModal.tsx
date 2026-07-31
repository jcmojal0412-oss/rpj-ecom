'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, Loader2, CheckCircle2, AlertCircle, X } from 'lucide-react';
import { formatCurrency, todayISO } from '@/lib/utils';
import { scanFinancingSale, normalizeDateToISO } from '@/lib/scan-receipt';

const PROVIDERS = ['SKYRO', 'BILLEASE', 'SALMON', 'HOME CREDIT', 'POS TERMINAL'];

interface SaleRow {
  provider: string;
  amount: string;
  date: string;
  customerName: string;
  referenceNo: string;
  saved: boolean;
}

interface ScanItem {
  file: File;
  previewUrl: string;
  status: 'scanning' | 'done' | 'error';
  error?: string;
  screenshotPath: string | null;
  rows: SaleRow[];
}

export default function FinancingScanModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<ScanItem[]>([]);
  const [saving, setSaving] = useState<string | null>(null); // `${itemIndex}-${rowIndex}`

  const updateItem = (i: number, patch: Partial<ScanItem>) =>
    setItems(prev => prev.map((it, idx) => idx === i ? { ...it, ...patch } : it));

  const updateRow = (i: number, r: number, patch: Partial<SaleRow>) =>
    setItems(prev => prev.map((it, idx) => idx === i
      ? { ...it, rows: it.rows.map((row, ridx) => ridx === r ? { ...row, ...patch } : row) }
      : it
    ));

  const handleFiles = async (files: FileList | File[]) => {
    const newItems: ScanItem[] = Array.from(files).map(file => ({
      file,
      previewUrl: URL.createObjectURL(file),
      status: 'scanning',
      screenshotPath: null,
      rows: [],
    }));
    setItems(prev => [...prev, ...newItems]);
    const offset = items.length;

    await Promise.all(newItems.map(async (item, j) => {
      const i = offset + j;

      // Upload for storage — non-blocking, independent of the AI scan result.
      const fd = new FormData();
      fd.append('file', item.file);
      fetch('/api/upload/receipt', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(d => { if (d.path) updateItem(i, { screenshotPath: d.path }); })
        .catch(() => {});

      try {
        // One screenshot can contain multiple sales — e.g. a cashier's chat
        // summary listing several financing providers at once.
        const sales = await scanFinancingSale(item.file);
        const rows: SaleRow[] = sales.map((s: any) => ({
          provider: PROVIDERS.includes(s.provider) ? s.provider : 'POS TERMINAL',
          amount: s.amount != null ? String(s.amount) : '',
          date: normalizeDateToISO(s.date) || todayISO(),
          customerName: s.customer_name || '',
          referenceNo: s.reference_no || '',
          saved: false,
        }));
        updateItem(i, { status: 'done', rows });
      } catch (err: any) {
        updateItem(i, { status: 'error', error: err.message || 'Scan failed' });
      }
    }));
  };

  // Ctrl+V a screenshot straight in — no need to save the file first.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.items ?? [])
        .filter(it => it.type.startsWith('image/'))
        .map(it => it.getAsFile())
        .filter((f): f is File => f !== null);
      if (files.length) handleFiles(files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [items]);

  const allSettled = () =>
    items.every(it => it.status === 'error' || (it.status === 'done' && it.rows.every(r => r.saved)));

  const saveRow = async (i: number, r: number) => {
    const row = items[i]?.rows[r];
    if (!row || !row.amount) return;
    const key = `${i}-${r}`;
    setSaving(key);
    try {
      const res = await fetch('/api/financing-sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: row.provider,
          amount: parseFloat(row.amount),
          sale_date: row.date || null,
          customer_name: row.customerName || null,
          reference_no: row.referenceNo || null,
          screenshot_path: items[i].screenshotPath,
        }),
      });
      if (res.ok) {
        setItems(prev => {
          const next = prev.map((it, idx) => idx === i
            ? { ...it, rows: it.rows.map((row2, ridx) => ridx === r ? { ...row2, saved: true } : row2) }
            : it
          );
          if (next.every(it => it.status === 'error' || (it.status === 'done' && it.rows.every(row2 => row2.saved)))) onSaved();
          return next;
        });
      }
    } finally {
      setSaving(null);
    }
  };

  const saveAll = async () => {
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.status !== 'done') continue;
      for (let r = 0; r < it.rows.length; r++) {
        if (!it.rows[r].saved && it.rows[r].amount) await saveRow(i, r);
      }
    }
    if (allSettled()) onSaved();
  };

  const pendingCount = items.reduce((sum, it) =>
    sum + (it.status === 'done' ? it.rows.filter(r => !r.saved && r.amount).length : 0), 0);

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        onClick={() => fileRef.current?.click()}
        className="border-2 border-dashed border-orange-300 rounded-xl p-6 text-center cursor-pointer hover:bg-orange-50/40 transition-colors"
      >
        <Camera className="mx-auto text-orange-400 mb-2" size={28} />
        <p className="text-sm font-semibold text-gray-700">Upload Sale Screenshots</p>
        <p className="text-xs text-gray-400 mt-1">
          Skyro, Billease, Salmon, Home Credit, POS terminal, o kahit chat summary na naglilista ng ilang sales — pwedeng multiple
        </p>
        <p className="text-xs text-orange-500 mt-1 font-medium">Pwede ring i-paste (Ctrl+V) ang copied screenshot</p>
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
          {items.map((item, i) => {
            const allRowsSaved = item.status === 'done' && item.rows.length > 0 && item.rows.every(r => r.saved);
            return (
              <div key={i} className={`border rounded-xl p-3 space-y-2 ${
                allRowsSaved ? 'border-green-200 bg-green-50/30' : 'border-gray-200 bg-white'
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

                    {item.status === 'done' && !allRowsSaved && (
                      <p className="text-xs text-gray-500 mt-0.5">
                        {item.rows.length > 1 ? `${item.rows.length} sales detected — review each below.` : 'Review the detected details below, then save.'}
                      </p>
                    )}
                  </div>

                  <button
                    onClick={() => setItems(prev => prev.filter((_, idx) => idx !== i))}
                    className="text-gray-300 hover:text-red-400 shrink-0"
                  >
                    <X size={14} />
                  </button>
                </div>

                {/* One editable card per detected sale row */}
                {item.status === 'done' && item.rows.map((row, r) => (
                  row.saved ? (
                    <div key={r} className="flex items-center gap-2 text-xs text-green-700 pt-1 border-t border-green-100">
                      <CheckCircle2 size={14} />
                      {row.provider} sale saved — {formatCurrency(parseFloat(row.amount || '0'))}
                    </div>
                  ) : (
                    <div key={r} className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-100">
                      <div className="col-span-2">
                        <label className="block text-[10px] font-medium text-gray-500 mb-0.5">Financing Provider</label>
                        <select
                          className="form-input text-sm py-1.5"
                          value={row.provider}
                          onChange={e => updateRow(i, r, { provider: e.target.value })}
                        >
                          {PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-medium text-gray-500 mb-0.5">Amount (₱)</label>
                        <input
                          type="number"
                          className="form-input text-sm py-1.5"
                          value={row.amount}
                          onChange={e => updateRow(i, r, { amount: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-medium text-gray-500 mb-0.5">Date</label>
                        <input
                          type="date"
                          className="form-input text-sm py-1.5"
                          value={row.date}
                          onChange={e => updateRow(i, r, { date: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-medium text-gray-500 mb-0.5">Customer Name</label>
                        <input
                          type="text"
                          className="form-input text-sm py-1.5"
                          value={row.customerName}
                          onChange={e => updateRow(i, r, { customerName: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-medium text-gray-500 mb-0.5">Reference No.</label>
                        <input
                          type="text"
                          className="form-input text-sm py-1.5"
                          value={row.referenceNo}
                          onChange={e => updateRow(i, r, { referenceNo: e.target.value })}
                        />
                      </div>
                      <div className="col-span-2 flex justify-end">
                        <button
                          onClick={() => saveRow(i, r)}
                          disabled={saving === `${i}-${r}` || !row.amount}
                          className="btn-primary text-xs py-1.5 disabled:opacity-50"
                        >
                          {saving === `${i}-${r}` ? <Loader2 size={12} className="animate-spin inline mr-1" /> : null}
                          {saving === `${i}-${r}` ? 'Saving...' : 'Save Sale'}
                        </button>
                      </div>
                    </div>
                  )
                ))}
              </div>
            );
          })}
        </div>
      )}

      {pendingCount > 1 && (
        <button onClick={saveAll} className="btn-primary w-full justify-center">
          Save All {pendingCount} Sales
        </button>
      )}

      <div className="flex justify-end">
        <button onClick={onClose} className="btn-secondary">Close</button>
      </div>
    </div>
  );
}
