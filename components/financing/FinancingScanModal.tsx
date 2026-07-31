'use client';

import { useRef, useState } from 'react';
import { Camera, Loader2, CheckCircle2, AlertCircle, X } from 'lucide-react';
import { formatCurrency, todayISO } from '@/lib/utils';
import { scanFinancingSale, normalizeDateToISO } from '@/lib/scan-receipt';

const PROVIDERS = ['SKYRO', 'BILLEASE', 'SALMON', 'HOME CREDIT', 'POS TERMINAL'];

interface ScanItem {
  file: File;
  previewUrl: string;
  status: 'scanning' | 'done' | 'error';
  error?: string;
  provider: string;
  amount: string;
  date: string;
  customerName: string;
  referenceNo: string;
  screenshotPath: string | null;
  saved: boolean;
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
  const [saving, setSaving] = useState<number | null>(null);

  const update = (i: number, patch: Partial<ScanItem>) =>
    setItems(prev => prev.map((it, idx) => idx === i ? { ...it, ...patch } : it));

  const handleFiles = async (files: FileList) => {
    const newItems: ScanItem[] = Array.from(files).map(file => ({
      file,
      previewUrl: URL.createObjectURL(file),
      status: 'scanning',
      provider: 'POS TERMINAL',
      amount: '',
      date: todayISO(),
      customerName: '',
      referenceNo: '',
      screenshotPath: null,
      saved: false,
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
        .then(d => { if (d.path) update(i, { screenshotPath: d.path }); })
        .catch(() => {});

      try {
        const s = await scanFinancingSale(item.file);
        update(i, {
          status: 'done',
          provider: PROVIDERS.includes(s.provider) ? s.provider : 'POS TERMINAL',
          amount: s.amount != null ? String(s.amount) : '',
          date: normalizeDateToISO(s.date) || todayISO(),
          customerName: s.customer_name || '',
          referenceNo: s.reference_no || '',
        });
      } catch (err: any) {
        update(i, { status: 'error', error: err.message || 'Scan failed' });
      }
    }));
  };

  const saveItem = async (i: number) => {
    const item = items[i];
    if (!item.amount) return;
    setSaving(i);
    try {
      const res = await fetch('/api/financing-sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: item.provider,
          amount: parseFloat(item.amount),
          sale_date: item.date || null,
          customer_name: item.customerName || null,
          reference_no: item.referenceNo || null,
          screenshot_path: item.screenshotPath,
        }),
      });
      if (res.ok) {
        update(i, { saved: true });
        setItems(prev => {
          if (prev.every((it, idx) => idx === i ? true : it.saved || it.status === 'error')) onSaved();
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
      if (!it.saved && it.status === 'done' && it.amount) await saveItem(i);
    }
    onSaved();
  };

  const pendingCount = items.filter(it => it.status === 'done' && it.amount && !it.saved).length;

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        onClick={() => fileRef.current?.click()}
        className="border-2 border-dashed border-orange-300 rounded-xl p-6 text-center cursor-pointer hover:bg-orange-50/40 transition-colors"
      >
        <Camera className="mx-auto text-orange-400 mb-2" size={28} />
        <p className="text-sm font-semibold text-gray-700">Upload Sale Screenshots</p>
        <p className="text-xs text-gray-400 mt-1">Skyro, Billease, Salmon, Home Credit, o POS terminal — pwedeng multiple</p>
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

                  {item.status === 'done' && !item.saved && (
                    <p className="text-xs text-gray-500 mt-0.5">Review the detected details below, then save.</p>
                  )}
                </div>

                <button
                  onClick={() => setItems(prev => prev.filter((_, idx) => idx !== i))}
                  className="text-gray-300 hover:text-red-400 shrink-0"
                >
                  <X size={14} />
                </button>
              </div>

              {/* Editable confirm fields */}
              {item.status === 'done' && !item.saved && (
                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-gray-100">
                  <div className="col-span-2">
                    <label className="block text-[10px] font-medium text-gray-500 mb-0.5">Financing Provider</label>
                    <select
                      className="form-input text-sm py-1.5"
                      value={item.provider}
                      onChange={e => update(i, { provider: e.target.value })}
                    >
                      {PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
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
                  <div>
                    <label className="block text-[10px] font-medium text-gray-500 mb-0.5">Customer Name</label>
                    <input
                      type="text"
                      className="form-input text-sm py-1.5"
                      value={item.customerName}
                      onChange={e => update(i, { customerName: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-gray-500 mb-0.5">Reference No.</label>
                    <input
                      type="text"
                      className="form-input text-sm py-1.5"
                      value={item.referenceNo}
                      onChange={e => update(i, { referenceNo: e.target.value })}
                    />
                  </div>
                  <div className="col-span-2 flex justify-end">
                    <button
                      onClick={() => saveItem(i)}
                      disabled={saving === i || !item.amount}
                      className="btn-primary text-xs py-1.5 disabled:opacity-50"
                    >
                      {saving === i ? <Loader2 size={12} className="animate-spin inline mr-1" /> : null}
                      {saving === i ? 'Saving...' : 'Save Sale'}
                    </button>
                  </div>
                </div>
              )}

              {item.saved && (
                <div className="flex items-center gap-2 text-xs text-green-700 pt-1 border-t border-green-100">
                  <CheckCircle2 size={14} />
                  {item.provider} sale saved — {formatCurrency(parseFloat(item.amount || '0'))}
                </div>
              )}
            </div>
          ))}
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
