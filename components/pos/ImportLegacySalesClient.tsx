'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, UploadCloud, CheckCircle2, AlertTriangle } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import Spinner from '@/components/ui/Spinner';

interface Business { id: number; name: string; }

interface Preview {
  total_rows: number; new_count: number; duplicate_count: number;
  parse_errors: string[]; parse_error_count: number;
  date_range: { from: string; to: string } | null;
  total_revenue: number;
}

interface Result { imported: number; skipped_duplicates: number; }

export default function ImportLegacySalesClient() {
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [isOwner, setIsOwner] = useState(false);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [businessName, setBusinessName] = useState('Bodega ni Suki');
  const [file, setFile] = useState<File | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(u => { setIsOwner(u?.role === 'owner'); setCheckingAuth(false); });
    fetch('/api/businesses').then(r => r.json()).then(d => {
      const rows: Business[] = d.rows ?? [];
      setBusinesses(rows);
      if (rows.some(b => b.name === 'Bodega ni Suki')) setBusinessName('Bodega ni Suki');
      else if (rows[0]) setBusinessName(rows[0].name);
    });
  }, []);

  const reset = () => {
    setFile(null);
    setPreview(null);
    setResult(null);
    setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const runPreview = async () => {
    if (!file) return;
    setPreviewing(true);
    setError('');
    setPreview(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('mode', 'preview');
      fd.append('business_name', businessName);
      const res = await fetch('/api/pos/sales/import-legacy', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to read this file'); return; }
      setPreview(data);
    } finally {
      setPreviewing(false);
    }
  };

  const runImport = async () => {
    if (!file) return;
    setImporting(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('mode', 'confirm');
      fd.append('business_name', businessName);
      const res = await fetch('/api/pos/sales/import-legacy', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Import failed'); return; }
      setResult(data);
      setPreview(null);
    } finally {
      setImporting(false);
    }
  };

  if (checkingAuth) {
    return <div className="h-screen flex items-center justify-center"><Spinner /></div>;
  }

  if (!isOwner) {
    return (
      <div className="p-6 max-w-md mx-auto text-center space-y-3">
        <AlertTriangle className="mx-auto text-amber-500" size={28} />
        <p className="text-sm text-gray-600">Only the owner can import historical sales.</p>
        <Link href="/pos/sales" className="btn-secondary inline-flex"><ArrowLeft size={14} /> Back to Sales History</Link>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/pos/sales" className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"><ArrowLeft size={18} /></Link>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Import Historical Sales</h1>
          <p className="text-sm text-gray-500">Upload a "POS Sales Report" export from the old system.</p>
        </div>
      </div>

      <div className="card space-y-4">
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 space-y-1">
          <p className="font-semibold">Before you import, know what this does — and doesn't — bring over:</p>
          <ul className="list-disc list-inside space-y-0.5">
            <li>Brings in date, totals, and cash/online payment split per sale.</li>
            <li>Does <strong>not</strong> bring in individual items — migrated sales won't appear in Product Sales Report or COGS-based reports.</li>
            <li>Does <strong>not</strong> assign a cashier (the old export has none) or a new BNS receipt number.</li>
            <li>Safe to re-upload overlapping files — sales already imported (matched by their original transaction ID) are skipped automatically, never duplicated.</li>
          </ul>
        </div>

        {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}

        {result ? (
          <div className="text-center space-y-3 py-4">
            <div className="flex items-center gap-2 justify-center text-green-600">
              <CheckCircle2 size={18} />
              <p className="text-sm font-bold">IMPORT COMPLETE</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-4 max-w-xs mx-auto space-y-1.5 text-sm text-left">
              <div className="flex justify-between text-gray-500"><span>Imported</span><span className="font-semibold text-gray-800 tabular-nums">{result.imported}</span></div>
              <div className="flex justify-between text-gray-500"><span>Skipped (already imported)</span><span className="font-semibold text-gray-800 tabular-nums">{result.skipped_duplicates}</span></div>
            </div>
            <div className="flex justify-center gap-3">
              <button onClick={reset} className="btn-secondary">Import Another File</button>
              <Link href="/pos/sales" className="btn-primary">View Sales History</Link>
            </div>
          </div>
        ) : (
          <>
            <div>
              <label className="form-label">Business</label>
              <select className="form-input" value={businessName} onChange={e => setBusinessName(e.target.value)}>
                {businesses.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
              </select>
              <p className="text-xs text-gray-400 mt-1">Every sale in this file will be attributed to this business.</p>
            </div>

            <div>
              <label className="form-label">Excel File (.xlsx)</label>
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="form-input"
                onChange={e => { setFile(e.target.files?.[0] ?? null); setPreview(null); setResult(null); setError(''); }} />
            </div>

            {preview && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2 text-sm">
                <p className="font-semibold text-blue-900">Preview</p>
                <div className="flex justify-between text-blue-800"><span>Rows in file</span><span className="tabular-nums font-medium">{preview.total_rows}</span></div>
                <div className="flex justify-between text-blue-800"><span>New (will be imported)</span><span className="tabular-nums font-medium">{preview.new_count}</span></div>
                <div className="flex justify-between text-blue-800"><span>Already imported (will be skipped)</span><span className="tabular-nums font-medium">{preview.duplicate_count}</span></div>
                {preview.date_range && (
                  <div className="flex justify-between text-blue-800">
                    <span>Date range</span>
                    <span className="font-medium">{formatDate(preview.date_range.from)} – {formatDate(preview.date_range.to)}</span>
                  </div>
                )}
                <div className="flex justify-between text-blue-900 font-bold border-t border-blue-200 pt-2">
                  <span>Revenue to be added</span><span className="tabular-nums">{formatCurrency(preview.total_revenue)}</span>
                </div>
                {preview.parse_error_count > 0 && (
                  <div className="text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 text-xs">
                    {preview.parse_error_count} row(s) couldn&apos;t be read and will be skipped.
                    {preview.parse_errors.length > 0 && (
                      <ul className="list-disc list-inside mt-1">
                        {preview.parse_errors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-3">
              {!preview ? (
                <button onClick={runPreview} disabled={!file || previewing} className="btn-secondary disabled:opacity-50">
                  <UploadCloud size={15} /> {previewing ? 'Reading...' : 'Preview'}
                </button>
              ) : (
                <>
                  <button onClick={() => setPreview(null)} className="btn-secondary">Back</button>
                  <button onClick={runImport} disabled={importing || preview.new_count === 0} className="btn-primary disabled:opacity-50">
                    {importing ? 'Importing...' : `Confirm Import (${preview.new_count})`}
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
