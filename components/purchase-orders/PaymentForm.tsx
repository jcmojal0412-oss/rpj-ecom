'use client';

import { useState, useRef } from 'react';
import { X, FileImage, CheckCircle, Loader2, Sparkles, AlertCircle } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { scanReceipt, normalizeDateToISO } from '@/lib/scan-receipt';

interface Props {
  poId: number;
  poNumber: string;
  totalAmount: number;
  currentPaid: number;
  currentReceiptPath: string | null;
  onSuccess: () => void;
  onCancel: () => void;
}

export default function PaymentForm({ poId, poNumber, totalAmount, currentPaid, currentReceiptPath, onSuccess, onCancel }: Props) {
  const [paidAmount, setPaidAmount]     = useState(currentPaid ? String(currentPaid) : '');
  const [paymentDate, setPaymentDate]   = useState(new Date().toISOString().slice(0, 10));
  const [paymentNotes, setPaymentNotes] = useState('');
  const [receiptPath, setReceiptPath]   = useState(currentReceiptPath ?? '');
  const [previewUrl, setPreviewUrl]     = useState<string | null>(null);

  const [scanning, setScanning]   = useState(false);
  const [scanDone, setScanDone]   = useState(false);
  const [scanError, setScanError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const outstanding = totalAmount - (parseFloat(paidAmount) || 0);
  const paymentStatus = !paidAmount || parseFloat(paidAmount) === 0
    ? 'Unpaid'
    : parseFloat(paidAmount) >= totalAmount
    ? 'Fully Paid'
    : 'Partial';

  const statusColor = paymentStatus === 'Fully Paid'
    ? 'text-green-700 bg-green-100'
    : paymentStatus === 'Partial'
    ? 'text-amber-700 bg-amber-100'
    : 'text-red-700 bg-red-100';

  const handleFile = async (file: File) => {
    setScanError('');
    setScanDone(false);
    setPreviewUrl(URL.createObjectURL(file));

    // 1. Scan with AI
    setScanning(true);
    try {
      const e = await scanReceipt(file);
      if (e.amount != null)  setPaidAmount(String(e.amount));
      const d = normalizeDateToISO(e.date);
      if (d) setPaymentDate(d);
      if (e.reference_no)    setPaymentNotes(prev => prev || `Ref: ${e.reference_no}`);
      setScanDone(true);
    } catch (err: any) {
      setScanError(err.message || 'Could not read receipt. Please fill in manually.');
    } finally {
      setScanning(false);
    }

    // 2. Upload file for storage (parallel-safe, non-blocking display)
    setUploading(true);
    try {
      const fd2 = new FormData();
      fd2.append('file', file);
      const res2  = await fetch('/api/upload/receipt', { method: 'POST', body: fd2 });
      const data2 = await res2.json();
      if (res2.ok) setReceiptPath(data2.path);
    } catch {
      // non-fatal — receipt path just won't be saved
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch(`/api/purchase-orders/${poId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paid_amount:   parseFloat(paidAmount) || 0,
          payment_date:  paymentDate || null,
          payment_notes: paymentNotes || null,
          receipt_path:  receiptPath || null,
        }),
      });
      if (!res.ok) { const d = await res.json(); setError(d.error); return; }
      onSuccess();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>
      )}

      {/* PO Summary */}
      <div className="bg-gray-50 rounded-xl p-4 grid grid-cols-3 gap-3 text-center">
        <div>
          <p className="text-xs text-gray-500">Total Amount</p>
          <p className="text-base font-bold text-gray-900">{formatCurrency(totalAmount)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Amount Paid</p>
          <p className="text-base font-bold text-green-700">{formatCurrency(parseFloat(paidAmount) || 0)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Outstanding</p>
          <p className={`text-base font-bold ${outstanding > 0 ? 'text-red-600' : 'text-green-600'}`}>
            {formatCurrency(Math.max(0, outstanding))}
          </p>
        </div>
      </div>

      <div className="flex justify-center">
        <span className={`px-4 py-1 rounded-full text-sm font-semibold ${statusColor}`}>
          {paymentStatus}
        </span>
      </div>

      {/* Receipt upload / scan zone */}
      <div>
        <label className="form-label">Receipt / Proof of Payment</label>

        {!previewUrl ? (
          <div
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed border-gray-300 rounded-xl px-4 py-8 text-center cursor-pointer hover:border-orange-400 hover:bg-orange-50/30 transition-colors"
          >
            <FileImage className="mx-auto text-gray-400 mb-2" size={28} />
            <p className="text-sm font-semibold text-gray-700">Upload Payment Screenshot</p>
            <p className="text-xs text-gray-400 mt-1 flex items-center justify-center gap-1">
              <Sparkles size={11} className="text-orange-400" />
              AI will auto-fill the amount, date &amp; reference
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Preview + scan status */}
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewUrl} alt="Receipt" className="w-full max-h-48 object-contain rounded-xl border border-gray-200 bg-gray-50" />
              <button
                type="button"
                onClick={() => { setPreviewUrl(null); setReceiptPath(''); setScanDone(false); setScanError(''); }}
                className="absolute top-2 right-2 bg-white rounded-full p-1 shadow text-gray-400 hover:text-red-500"
              >
                <X size={14} />
              </button>
            </div>

            {scanning && (
              <div className="flex items-center gap-2 text-sm text-orange-600 bg-orange-50 rounded-lg px-3 py-2">
                <Loader2 size={14} className="animate-spin" />
                AI is reading your receipt...
              </div>
            )}
            {scanDone && !scanning && (
              <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">
                <CheckCircle size={14} />
                Auto-filled from receipt — please verify below
              </div>
            )}
            {scanError && (
              <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                <AlertCircle size={14} />
                {scanError}
              </div>
            )}
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
        />
      </div>

      {/* Amount paid */}
      <div>
        <label className="form-label">Amount Paid (₱)</label>
        <input
          type="number"
          step="0.01"
          min="0"
          className="form-input"
          placeholder="0.00"
          value={paidAmount}
          onChange={e => setPaidAmount(e.target.value)}
        />
        <button type="button" onClick={() => setPaidAmount(String(totalAmount))}
          className="text-xs text-blue-600 hover:text-blue-800 font-medium mt-1.5">
          Mark as Fully Paid ({formatCurrency(totalAmount)})
        </button>
      </div>

      {/* Payment date */}
      <div>
        <label className="form-label">Payment Date</label>
        <input type="date" className="form-input" value={paymentDate}
          onChange={e => setPaymentDate(e.target.value)} />
      </div>

      {/* Notes */}
      <div>
        <label className="form-label">Notes (optional)</label>
        <input className="form-input" placeholder="e.g. Paid via GCash, Ref: 12345..."
          value={paymentNotes} onChange={e => setPaymentNotes(e.target.value)} />
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onCancel} className="btn-secondary">Cancel</button>
        <button type="submit" disabled={submitting || scanning || uploading} className="btn-primary disabled:opacity-50">
          {submitting ? 'Saving...' : 'Save Payment'}
        </button>
      </div>
    </form>
  );
}
