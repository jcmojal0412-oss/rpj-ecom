'use client';

import { useState, useRef } from 'react';
import { Upload, X, FileImage, CheckCircle } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

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
  const [uploading, setUploading]       = useState(false);
  const [submitting, setSubmitting]     = useState(false);
  const [error, setError]               = useState('');
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

  const handleUpload = async (file: File) => {
    setUploading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res  = await fetch('/api/upload/receipt', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Upload failed'); return; }
      setReceiptPath(data.path);
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

      {/* Status badge */}
      <div className="flex justify-center">
        <span className={`px-4 py-1 rounded-full text-sm font-semibold ${statusColor}`}>
          {paymentStatus}
        </span>
      </div>

      {/* Amount paid */}
      <div>
        <label className="form-label">Amount Paid (₱)</label>
        <input
          type="number"
          step="0.01"
          min="0"
          max={totalAmount}
          className="form-input"
          placeholder="0.00"
          value={paidAmount}
          onChange={e => setPaidAmount(e.target.value)}
          autoFocus
        />
        <div className="flex gap-2 mt-1.5">
          <button type="button" onClick={() => setPaidAmount(String(totalAmount))}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium">
            Mark as Fully Paid ({formatCurrency(totalAmount)})
          </button>
        </div>
      </div>

      {/* Payment date */}
      <div>
        <label className="form-label">Payment Date</label>
        <input type="date" className="form-input" value={paymentDate}
          onChange={e => setPaymentDate(e.target.value)} />
      </div>

      {/* Payment notes */}
      <div>
        <label className="form-label">Notes (optional)</label>
        <input className="form-input" placeholder="e.g. Paid via bank transfer, GCash..."
          value={paymentNotes} onChange={e => setPaymentNotes(e.target.value)} />
      </div>

      {/* Receipt upload */}
      <div>
        <label className="form-label">Receipt / Proof of Payment</label>
        {receiptPath ? (
          <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
            <CheckCircle size={18} className="text-green-600 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-green-800">Receipt uploaded</p>
              <a href={receiptPath} target="_blank" rel="noopener noreferrer"
                className="text-xs text-blue-600 hover:underline">View receipt</a>
            </div>
            <button type="button" onClick={() => setReceiptPath('')}
              className="text-gray-400 hover:text-red-500">
              <X size={16} />
            </button>
          </div>
        ) : (
          <div
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed border-gray-300 rounded-xl px-4 py-6 text-center cursor-pointer hover:border-orange-400 hover:bg-orange-50/30 transition-colors"
          >
            {uploading ? (
              <div className="flex items-center justify-center gap-2 text-orange-500">
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25"/>
                  <path fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" className="opacity-75"/>
                </svg>
                <span className="text-sm font-medium">Uploading...</span>
              </div>
            ) : (
              <>
                <FileImage className="mx-auto text-gray-400 mb-2" size={24} />
                <p className="text-sm text-gray-600 font-medium">I-attach ang resibo</p>
                <p className="text-xs text-gray-400 mt-1">JPG, PNG, PDF — max 5MB</p>
              </>
            )}
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*,.pdf"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); }}
        />
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onCancel} className="btn-secondary">Cancel</button>
        <button type="submit" disabled={submitting} className="btn-primary disabled:opacity-50">
          {submitting ? 'Saving...' : 'Save Payment'}
        </button>
      </div>
    </form>
  );
}
