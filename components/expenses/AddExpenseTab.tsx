'use client';

import { useState, useEffect } from 'react';
import { todayISO } from '@/lib/utils';
import { Toast, useToast } from '@/components/ui/Toast';
import { EXPENSE_CATEGORIES, PAYMENT_METHODS, type Business, type Expense } from './constants';
import AIReceiptCapture, { type AICapturedFields } from './AIReceiptCapture';
import DuplicateWarningModal from './DuplicateWarningModal';

interface Props {
  onSaved: () => void;
}

export default function AddExpenseTab({ onSaved }: Props) {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [businessId, setBusinessId] = useState('');
  const [category, setCategory] = useState('');
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState('');
  const [paidTo, setPaidTo] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [referenceNo, setReferenceNo] = useState('');
  const [notes, setNotes] = useState('');
  const [receiptPath, setReceiptPath] = useState<string | null>(null);
  const [aiProcessed, setAiProcessed] = useState(false);
  const [aiConfidence, setAiConfidence] = useState<string[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [duplicate, setDuplicate] = useState<Expense | null>(null);
  const [pendingAIConfirm, setPendingAIConfirm] = useState(false);
  const { toast, showToast, clearToast } = useToast();

  useEffect(() => {
    fetch('/api/businesses').then(r => r.json()).then(d => setBusinesses(d.rows ?? []));
  }, []);

  // "Confirm & Save" populates state above, then this fires on the next
  // render (once the new field values have actually committed) so submit()
  // never reads stale state from before the AI values landed.
  useEffect(() => {
    if (!pendingAIConfirm) return;
    setPendingAIConfirm(false);
    submit(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAIConfirm]);

  const resetForm = () => {
    setBusinessId(''); setCategory(''); setDate(todayISO()); setAmount('');
    setPaidTo(''); setPaymentMethod(''); setReferenceNo(''); setNotes('');
    setReceiptPath(null); setAiProcessed(false); setAiConfidence(null);
  };

  const handleAICaptured = (fields: AICapturedFields) => {
    if (fields.date) setDate(fields.date);
    if (fields.amount) setAmount(fields.amount);
    if (fields.paid_to) setPaidTo(fields.paid_to);
    if (fields.reference_number) setReferenceNo(fields.reference_number);
    if (fields.payment_method) setPaymentMethod(fields.payment_method);
    if (fields.suggested_category) setCategory(fields.suggested_category);
    if (fields.suggested_business_id) setBusinessId(String(fields.suggested_business_id));
    setReceiptPath(fields.receipt_path);
    setAiProcessed(true);
    setAiConfidence(fields.unable_to_detect);
  };

  const submit = async (force = false) => {
    setSubmitting(true);
    try {
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: Number(businessId), category, date, amount,
          paid_to: paidTo, payment_method: paymentMethod || null,
          reference_no: referenceNo || null, notes: notes || null,
          receipt_path: receiptPath, ai_processed: aiProcessed,
          ai_confidence: aiConfidence, force,
        }),
      });
      if (res.status === 409) {
        const data = await res.json();
        setDuplicate(data.possible_duplicate);
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Failed to save expense', 'error');
        return;
      }
      showToast(aiProcessed ? 'Expense saved — marked For Review' : 'Expense saved!');
      resetForm();
      onSaved();
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = !!businessId && !!category && !!date && !!amount && paidTo.trim() !== '';

  // "Confirm & Save" resolves required fields directly from the just-captured
  // AI values merged with whatever's already in state (not from state alone,
  // which hasn't committed yet) — if something required is still missing,
  // populate the form and stop, with a specific toast, instead of firing a
  // save that the server will reject anyway.
  const handleAIConfirmSave = (fields: AICapturedFields) => {
    handleAICaptured(fields);
    const resolvedBusinessId = fields.suggested_business_id ? String(fields.suggested_business_id) : businessId;
    const resolvedCategory = fields.suggested_category || category;
    const resolvedDate = fields.date || date;
    const resolvedAmount = fields.amount || amount;
    const resolvedPaidTo = (fields.paid_to || paidTo).trim();
    if (!resolvedBusinessId || !resolvedCategory || !resolvedDate || !resolvedAmount || !resolvedPaidTo) {
      showToast('AI couldn’t fill in everything — finish the missing fields below, then click Save Expense', 'error');
      return;
    }
    setPendingAIConfirm(true);
  };

  const handleSkipAI = (path: string) => {
    setReceiptPath(path);
    showToast('Receipt attached — fill in the details below');
  };

  return (
    <div className="max-w-2xl space-y-6">
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}

      <div className="card">
        <p className="text-sm font-semibold text-gray-800 mb-1">Receipt / Proof of Payment</p>
        <p className="text-xs text-gray-400 mb-4">Optional — upload a receipt or payment screenshot and AI will fill in the fields below for you to review.</p>
        <AIReceiptCapture
          businesses={businesses}
          onCaptured={handleAICaptured}
          onConfirmSave={handleAIConfirmSave}
          onSkipAI={handleSkipAI}
        />
      </div>

      <form onSubmit={e => { e.preventDefault(); if (canSubmit) submit(false); }} className="card space-y-4">
        <p className="text-sm font-semibold text-gray-800">Expense Details</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="form-label">Business *</label>
            <select className="form-input" value={businessId} onChange={e => setBusinessId(e.target.value)} required>
              <option value="">Select business</option>
              {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">Category *</label>
            <select className="form-input" value={category} onChange={e => setCategory(e.target.value)} required>
              <option value="">Select category</option>
              {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">Expense Date *</label>
            <input type="date" className="form-input" value={date} onChange={e => setDate(e.target.value)} required />
          </div>
          <div>
            <label className="form-label">Amount (₱) *</label>
            <input type="number" step="0.01" min="0.01" className="form-input" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} required />
          </div>
          <div className="col-span-2">
            <label className="form-label">Paid To / Supplier *</label>
            <input className="form-input" placeholder="e.g. Meta Platforms, ABC Supplier, Meralco" value={paidTo} onChange={e => setPaidTo(e.target.value)} required />
          </div>
          <div>
            <label className="form-label">Payment Method</label>
            <select className="form-input" value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>
              <option value="">— Select —</option>
              {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">Reference Number</label>
            <input className="form-input" placeholder="Optional" value={referenceNo} onChange={e => setReferenceNo(e.target.value)} />
          </div>
          <div className="col-span-2">
            <label className="form-label">Notes</label>
            <textarea className="form-input" rows={3} placeholder="Optional" value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
        </div>

        {aiProcessed && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            This will save as <strong>For Review</strong> since it came from an AI-scanned receipt — mark it Verified later from Transactions once you've double-checked it.
          </p>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={resetForm} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={submitting || !canSubmit} className="btn-primary disabled:opacity-50">
            {submitting ? 'Saving...' : 'Save Expense'}
          </button>
        </div>
      </form>

      {duplicate && (
        <DuplicateWarningModal
          existing={duplicate}
          businesses={businesses}
          onCancel={() => setDuplicate(null)}
          onContinue={() => { setDuplicate(null); submit(true); }}
        />
      )}
    </div>
  );
}
