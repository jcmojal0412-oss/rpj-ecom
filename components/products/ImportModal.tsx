'use client';

import { useState, useRef, useCallback } from 'react';
import { Upload, FileSpreadsheet, CheckCircle, XCircle, AlertTriangle, Download, ArrowDown } from 'lucide-react';

interface ImportResult {
  total: number;
  imported: number;
  updated: number;
  skipped: number;
  errors: string[];
}

interface PreviewResult {
  total: number;
  new_count: number;
  update_count: number;
  skipped: number;
  errors: string[];
  decrease_count: number;
  decreases: { sku: string; name: string; old_qty: number; new_qty: number }[];
}

interface Props {
  onSuccess: () => void;
  onClose: () => void;
}

type Stage = 'idle' | 'reading' | 'preview' | 'importing' | 'done' | 'error';

export default function ImportModal({ onSuccess, onClose }: Props) {
  const [stage, setStage]   = useState<Stage>('idle');
  const [file, setFile]     = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [errMsg, setErrMsg] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const downloadTemplate = () => {
    window.location.href = '/api/products/template';
  };

  const readFile = useCallback(async (f: File) => {
    setFile(f);
    setStage('reading');
    setPreview(null);
    setErrMsg('');
    try {
      const fd = new FormData();
      fd.append('file', f);
      fd.append('mode', 'preview');
      const res  = await fetch('/api/products/import', { method: 'POST', body: fd });
      const data = await res.json();

      if (!res.ok) {
        setErrMsg(data.error ?? 'Upload failed');
        setStage('error');
        return;
      }
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
      const res  = await fetch('/api/products/import', { method: 'POST', body: fd });
      const data = await res.json();

      if (!res.ok) {
        setErrMsg(data.error ?? 'Import failed');
        setStage('error');
        return;
      }
      setResult(data);
      setStage('done');
      if (data.imported > 0 || data.updated > 0) onSuccess();
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

      {/* Step 1 — Download template */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <FileSpreadsheet className="text-blue-600 shrink-0 mt-0.5" size={20} />
          <div className="flex-1">
            <p className="text-sm font-semibold text-blue-900">Step 1 — Download the template</p>
            <p className="text-xs text-blue-700 mt-0.5">
              I-fill in ang Excel template na ito. May sample rows na para alam mo ang format.
            </p>
            <button
              onClick={downloadTemplate}
              className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Download size={13} /> Download Template (.xlsx)
            </button>
          </div>
        </div>
      </div>

      {/* Step 2 — Upload */}
      <div>
        <p className="text-sm font-semibold text-gray-700 mb-2">Step 2 — Upload ang filled template</p>

        {stage === 'idle' || stage === 'error' ? (
          <>
            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                dragging
                  ? 'border-green-500 bg-green-50'
                  : 'border-gray-300 hover:border-green-400 hover:bg-gray-50'
              }`}
            >
              <Upload className="mx-auto text-gray-400 mb-2" size={28} />
              <p className="text-sm font-medium text-gray-700">
                I-drag dito ang Excel file mo
              </p>
              <p className="text-xs text-gray-400 mt-1">o i-click para pumili ng file</p>
              <p className="text-xs text-gray-300 mt-2">.xlsx / .xls supported</p>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleFileChange}
            />
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
              <span className="text-sm font-medium">{stage === 'reading' ? 'Binabasa ang file...' : 'Nag-i-import...'}</span>
            </div>
          </div>
        ) : stage === 'preview' && preview ? (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-green-50 rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-green-700">{preview.new_count}</p>
                <p className="text-xs text-green-600 mt-0.5">Bagong Product</p>
              </div>
              <div className="bg-blue-50 rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-blue-700">{preview.update_count}</p>
                <p className="text-xs text-blue-600 mt-0.5">Ia-update</p>
              </div>
              <div className={`rounded-xl p-3 text-center ${preview.skipped > 0 ? 'bg-amber-50' : 'bg-gray-50'}`}>
                <p className={`text-2xl font-bold ${preview.skipped > 0 ? 'text-amber-700' : 'text-gray-400'}`}>{preview.skipped}</p>
                <p className={`text-xs mt-0.5 ${preview.skipped > 0 ? 'text-amber-600' : 'text-gray-400'}`}>Iski-skip</p>
              </div>
            </div>

            {preview.decrease_count > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-xs font-semibold text-red-800 mb-2 flex items-center gap-1">
                  <ArrowDown size={13} /> {preview.decrease_count} product{preview.decrease_count === 1 ? '' : 's'} — BABABA ang stock (i-check muna bago mag-confirm):
                </p>
                <ul className="space-y-1 max-h-40 overflow-y-auto">
                  {preview.decreases.map((d, i) => (
                    <li key={i} className="text-xs text-red-700 flex justify-between gap-2">
                      <span className="truncate">{d.sku} — {d.name}</span>
                      <span className="shrink-0 tabular-nums font-medium">{d.old_qty} → {d.new_qty}</span>
                    </li>
                  ))}
                </ul>
                {preview.decrease_count > preview.decreases.length && (
                  <p className="text-[11px] text-red-500 mt-1">+{preview.decrease_count - preview.decreases.length} pa...</p>
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
              <button onClick={confirmImport} className="btn-primary text-sm">Confirm Import</button>
            </div>
          </div>
        ) : result ? (
          <div className="space-y-3">
            {/* Summary */}
            <div className="grid grid-cols-4 gap-3">
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-gray-900">{result.total}</p>
                <p className="text-xs text-gray-500 mt-0.5">Total Rows</p>
              </div>
              <div className="bg-green-50 rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-green-700">{result.imported}</p>
                <p className="text-xs text-green-600 mt-0.5 flex items-center justify-center gap-1">
                  <CheckCircle size={11} /> New
                </p>
              </div>
              <div className="bg-blue-50 rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-blue-700">{result.updated}</p>
                <p className="text-xs text-blue-600 mt-0.5 flex items-center justify-center gap-1">
                  <CheckCircle size={11} /> Updated
                </p>
              </div>
              <div className={`rounded-xl p-3 text-center ${result.skipped > 0 ? 'bg-amber-50' : 'bg-gray-50'}`}>
                <p className={`text-2xl font-bold ${result.skipped > 0 ? 'text-amber-700' : 'text-gray-400'}`}>
                  {result.skipped}
                </p>
                <p className={`text-xs mt-0.5 flex items-center justify-center gap-1 ${result.skipped > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
                  <AlertTriangle size={11} /> Skipped
                </p>
              </div>
            </div>

            {/* Success message */}
            {(result.imported > 0 || result.updated > 0) && (
              <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-4 py-2.5 text-sm text-green-800">
                <CheckCircle size={15} className="shrink-0" />
                {result.imported > 0 && `${result.imported} bagong product`}
                {result.imported > 0 && result.updated > 0 && ', '}
                {result.updated > 0 && `${result.updated} na-update`}
                {' '}sa catalog!
              </div>
            )}

            {/* Errors list */}
            {result.errors.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p className="text-xs font-semibold text-amber-800 mb-2 flex items-center gap-1">
                  <AlertTriangle size={13} /> Mga na-skip ({result.errors.length}):
                </p>
                <ul className="space-y-1 max-h-36 overflow-y-auto">
                  {result.errors.map((err, i) => (
                    <li key={i} className="text-xs text-amber-700">• {err}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Import another */}
            <button
              onClick={startOver}
              className="text-xs text-blue-600 hover:text-blue-800 font-medium"
            >
              ← Mag-import ng isa pang file
            </button>
          </div>
        ) : null}
      </div>

      {/* Footer */}
      <div className="flex justify-end pt-2 border-t border-gray-100">
        <button onClick={onClose} className="btn-secondary text-sm">
          {stage === 'done' ? 'Close' : 'Cancel'}
        </button>
      </div>
    </div>
  );
}
