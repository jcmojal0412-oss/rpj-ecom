'use client';

import { useState, useRef, useCallback } from 'react';
import { Upload, FileSpreadsheet, CheckCircle, XCircle, AlertTriangle, Download } from 'lucide-react';
import { formatDate } from '@/lib/utils';

interface Change { sku: string; name: string; old_qty: number; new_qty: number; }

interface PreviewResult {
  total_rows: number; change_count: number; blank_skipped: number;
  errors: string[]; changes: Change[]; changes_truncated: boolean;
}

interface ImportResult {
  total_rows: number; updated: number; blank_skipped: number; errors: string[];
}

interface Props {
  onSuccess: () => void;
  onClose: () => void;
}

type Stage = 'idle' | 'reading' | 'preview' | 'importing' | 'done' | 'error';

export default function BulkCountImportModal({ onSuccess, onClose }: Props) {
  const [stage, setStage] = useState<Stage>('idle');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [errMsg, setErrMsg] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const downloadTemplate = () => { window.location.href = '/api/inventory/bulk-count/template'; };

  const readFile = useCallback(async (f: File) => {
    setFile(f);
    setStage('reading');
    setPreview(null);
    setErrMsg('');
    try {
      const fd = new FormData();
      fd.append('file', f);
      fd.append('mode', 'preview');
      const res = await fetch('/api/inventory/bulk-count/import', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) { setErrMsg(data.error ?? 'Upload failed'); setStage('error'); return; }
      setPreview(data);
      setStage('preview');
    } catch (e) {
      setErrMsg(String(e));
      setStage('error');
    }
  }, []);

  const confirmImport = useCallback(async () => {
    if (!file) return;
    setStage('importing');
    setErrMsg('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('mode', 'confirm');
      const res = await fetch('/api/inventory/bulk-count/import', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) { setErrMsg(data.error ?? 'Import failed'); setStage('error'); return; }
      setResult(data);
      setStage('done');
      if (data.updated > 0) onSuccess();
    } catch (e) {
      setErrMsg(String(e));
      setStage('error');
    }
  }, [file, onSuccess]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) readFile(f);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) readFile(f);
  };

  const startOver = () => { setStage('idle'); setFile(null); setPreview(null); setResult(null); setErrMsg(''); };

  return (
    <div className="space-y-5">
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <FileSpreadsheet className="text-blue-600 shrink-0 mt-0.5" size={20} />
          <div className="flex-1">
            <p className="text-sm font-semibold text-blue-900">Step 1 — Download the count sheet</p>
            <p className="text-xs text-blue-700 mt-0.5">
              Pre-filled na ng lahat ng products (SKU, pangalan, current stock) — fill in mo lang ang &quot;Counted Qty&quot; column
              base sa aktwal na binilang mo. Puwede mong iwanang blangko yung hindi mo pa nabibilang — hindi ito magiging 0,
              lalaktawan lang.
            </p>
            <button
              onClick={downloadTemplate}
              className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Download size={13} /> Download Count Sheet (.xlsx)
            </button>
          </div>
        </div>
      </div>

      <div>
        <p className="text-sm font-semibold text-gray-700 mb-2">Step 2 — Upload ang na-fill-out na sheet</p>

        {stage === 'idle' || stage === 'error' ? (
          <>
            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                dragging ? 'border-green-500 bg-green-50' : 'border-gray-300 hover:border-green-400 hover:bg-gray-50'
              }`}
            >
              <Upload className="mx-auto text-gray-400 mb-2" size={28} />
              <p className="text-sm font-medium text-gray-700">I-drag dito ang Excel file mo</p>
              <p className="text-xs text-gray-400 mt-1">o i-click para pumili ng file</p>
              <p className="text-xs text-gray-300 mt-2">.xlsx / .xls supported</p>
            </div>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />
            {stage === 'error' && (
              <div className="mt-3 flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
                <XCircle size={16} className="shrink-0" />
                {errMsg}
              </div>
            )}
          </>
        ) : stage === 'reading' || stage === 'importing' ? (
          <div className="border-2 border-dashed border-green-300 rounded-xl p-8 text-center bg-green-50">
            <div className="flex items-center justify-center gap-2 text-green-700">
              <svg className="animate-spin" width={20} height={20} viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
                <path fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" className="opacity-75" />
              </svg>
              <span className="text-sm font-medium">{stage === 'reading' ? 'Binabasa ang file...' : 'Ina-apply ang mga pagbabago...'}</span>
            </div>
          </div>
        ) : stage === 'preview' && preview ? (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-blue-50 rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-blue-700">{preview.change_count}</p>
                <p className="text-xs text-blue-600 mt-0.5">Babaguhin</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-gray-500">{preview.blank_skipped}</p>
                <p className="text-xs text-gray-400 mt-0.5">Blangko (skip)</p>
              </div>
              <div className={`rounded-xl p-3 text-center ${preview.errors.length > 0 ? 'bg-amber-50' : 'bg-gray-50'}`}>
                <p className={`text-2xl font-bold ${preview.errors.length > 0 ? 'text-amber-700' : 'text-gray-400'}`}>{preview.errors.length}</p>
                <p className={`text-xs mt-0.5 ${preview.errors.length > 0 ? 'text-amber-600' : 'text-gray-400'}`}>May Error</p>
              </div>
            </div>

            {preview.change_count === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">Walang makikitang pagbabago — siguraduhing na-fill-out ang &quot;Counted Qty&quot; column.</p>
            ) : (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                <p className="text-xs font-semibold text-gray-700 mb-2">Preview ng mga babaguhin:</p>
                <ul className="space-y-1 max-h-56 overflow-y-auto">
                  {preview.changes.map((c, i) => (
                    <li key={i} className="text-xs text-gray-700 flex justify-between gap-2">
                      <span className="truncate">{c.sku} — {c.name}</span>
                      <span className={`shrink-0 tabular-nums font-medium ${c.new_qty < c.old_qty ? 'text-red-600' : 'text-green-600'}`}>
                        {c.old_qty} → {c.new_qty}
                      </span>
                    </li>
                  ))}
                </ul>
                {preview.changes_truncated && (
                  <p className="text-[11px] text-gray-400 mt-1">+{preview.change_count - preview.changes.length} pa...</p>
                )}
              </div>
            )}

            {preview.errors.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p className="text-xs font-semibold text-amber-800 mb-2 flex items-center gap-1">
                  <AlertTriangle size={13} /> Mga iski-skip ({preview.errors.length}):
                </p>
                <ul className="space-y-1 max-h-32 overflow-y-auto">
                  {preview.errors.map((err, i) => <li key={i} className="text-xs text-amber-700">• {err}</li>)}
                </ul>
              </div>
            )}

            <div className="flex justify-between items-center pt-1">
              <button onClick={startOver} className="text-xs text-gray-500 hover:text-gray-700 font-medium">← Ibang file</button>
              <button onClick={confirmImport} disabled={preview.change_count === 0} className="btn-primary text-sm disabled:opacity-40">
                Confirm ({preview.change_count})
              </button>
            </div>
          </div>
        ) : result ? (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-gray-900">{result.total_rows}</p>
                <p className="text-xs text-gray-500 mt-0.5">Total Rows</p>
              </div>
              <div className="bg-green-50 rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-green-700">{result.updated}</p>
                <p className="text-xs text-green-600 mt-0.5 flex items-center justify-center gap-1"><CheckCircle size={11} /> Na-update</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-gray-400">{result.blank_skipped}</p>
                <p className="text-xs text-gray-400 mt-0.5">Blangko (skip)</p>
              </div>
            </div>

            {result.updated > 0 && (
              <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-4 py-2.5 text-sm text-green-800">
                <CheckCircle size={15} className="shrink-0" />
                {result.updated} product{result.updated === 1 ? '' : 's'} na-update as of {formatDate(new Date().toISOString())}
              </div>
            )}

            {result.errors.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p className="text-xs font-semibold text-amber-800 mb-2 flex items-center gap-1">
                  <AlertTriangle size={13} /> Mga na-skip ({result.errors.length}):
                </p>
                <ul className="space-y-1 max-h-36 overflow-y-auto">
                  {result.errors.map((err, i) => <li key={i} className="text-xs text-amber-700">• {err}</li>)}
                </ul>
              </div>
            )}

            <button onClick={startOver} className="text-xs text-blue-600 hover:text-blue-800 font-medium">← Mag-upload ng isa pang file</button>
          </div>
        ) : null}
      </div>

      <div className="flex justify-end pt-2 border-t border-gray-100">
        <button onClick={onClose} className="btn-secondary text-sm">{stage === 'done' ? 'Close' : 'Cancel'}</button>
      </div>
    </div>
  );
}
