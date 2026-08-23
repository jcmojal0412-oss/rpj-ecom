'use client';

import { useState } from 'react';
import { Pencil, Trash2, ZoomIn, CheckCircle2 } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import Modal from '@/components/ui/Modal';
import { EXPENSE_CATEGORIES, PAYMENT_METHODS, type Business, type Expense } from './constants';
import DeleteExpenseModal from './DeleteExpenseModal';

interface Props {
  expense: Expense;
  businesses: Business[];
  onClose: () => void;
  onChanged: () => void;
  initialEditing?: boolean;
}

export default function ExpenseDetailsModal({ expense, businesses, onClose, onChanged, initialEditing = false }: Props) {
  const [editing, setEditing] = useState(initialEditing);
  const [showDelete, setShowDelete] = useState(false);
  const [showImage, setShowImage] = useState(false);
  const [saving, setSaving] = useState(false);

  const [businessId, setBusinessId] = useState(String(expense.business_id ?? ''));
  const [category, setCategory] = useState(expense.category);
  const [date, setDate] = useState(expense.date.slice(0, 10));
  const [amount, setAmount] = useState(String(expense.amount));
  const [paidTo, setPaidTo] = useState(expense.paid_to ?? '');
  const [paymentMethod, setPaymentMethod] = useState(expense.payment_method ?? '');
  const [referenceNo, setReferenceNo] = useState(expense.reference_no ?? '');
  const [notes, setNotes] = useState(expense.description ?? '');

  const putUpdate = async (overrides: Record<string, unknown> = {}) => {
    await fetch(`/api/expenses/${expense.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        business_id: Number(businessId), category, date, amount, paid_to: paidTo,
        payment_method: paymentMethod || null, reference_no: referenceNo || null,
        notes: notes || null, receipt_path: expense.receipt_path,
        ...overrides,
      }),
    });
  };

  const saveEdit = async () => {
    setSaving(true);
    try {
      await putUpdate();
      setEditing(false);
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  const markVerified = async () => {
    await putUpdate({ status: 'Verified' });
    onChanged();
  };

  return (
    <>
      <Modal open onClose={onClose} title={editing ? 'Edit Expense' : 'Expense Details'} size="md">
        {!editing ? (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <span className={expense.status === 'Verified' ? 'badge-green' : 'badge-amber'}>{expense.status}</span>
              <span className="text-xl font-bold text-gray-900">{formatCurrency(expense.amount)}</span>
            </div>
            <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
              <Row label="Business" value={expense.business_name || '—'} />
              <Row label="Category" value={expense.category} />
              <Row label="Expense Date" value={formatDate(expense.date)} />
              <Row label="Paid To" value={expense.paid_to || '—'} />
              <Row label="Payment Method" value={expense.payment_method || '—'} />
              <Row label="Reference Number" value={expense.reference_no || '—'} />
              <Row label="Notes" value={expense.description || '—'} />
              <Row label="Created By" value={expense.created_by_name || '—'} />
              <Row label="Date Created" value={formatDate(expense.created_at)} />
            </div>
            {expense.receipt_path && (
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1.5">Receipt</p>
                <button type="button" onClick={() => setShowImage(true)} className="relative group">
                  <img src={expense.receipt_path} alt="Receipt" className="h-32 rounded-lg border border-gray-200 object-cover" />
                  <span className="absolute inset-0 bg-black/0 group-hover:bg-black/20 rounded-lg flex items-center justify-center transition-colors">
                    <ZoomIn className="text-white opacity-0 group-hover:opacity-100" size={20} />
                  </span>
                </button>
              </div>
            )}
            {expense.status === 'For Review' && (
              <button type="button" onClick={markVerified} className="text-xs font-semibold text-green-700 hover:text-green-800 flex items-center gap-1">
                <CheckCircle2 size={14} /> Mark as Verified
              </button>
            )}
            <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
              <button type="button" onClick={() => setShowDelete(true)} className="btn-secondary text-red-600 hover:bg-red-50">
                <Trash2 size={14} /> Delete Expense
              </button>
              <button type="button" onClick={() => setEditing(true)} className="btn-primary">
                <Pencil size={14} /> Edit Expense
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
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
                  {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Expense Date *</label>
                <input type="date" className="form-input" value={date} onChange={e => setDate(e.target.value)} required />
              </div>
              <div>
                <label className="form-label">Amount (₱) *</label>
                <input type="number" step="0.01" min="0.01" className="form-input" value={amount} onChange={e => setAmount(e.target.value)} required />
              </div>
              <div className="col-span-2">
                <label className="form-label">Paid To / Supplier *</label>
                <input className="form-input" value={paidTo} onChange={e => setPaidTo(e.target.value)} required />
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
                <input className="form-input" value={referenceNo} onChange={e => setReferenceNo(e.target.value)} />
              </div>
              <div className="col-span-2">
                <label className="form-label">Notes</label>
                <textarea className="form-input" rows={3} value={notes} onChange={e => setNotes(e.target.value)} />
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setEditing(false)} className="btn-secondary">Cancel</button>
              <button type="button" onClick={saveEdit} disabled={saving} className="btn-primary disabled:opacity-50">
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {showImage && expense.receipt_path && (
        <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-6" onClick={() => setShowImage(false)}>
          <img src={expense.receipt_path} alt="Receipt" className="max-h-[90vh] max-w-full rounded-lg" />
        </div>
      )}

      {showDelete && (
        <DeleteExpenseModal
          expense={expense}
          onCancel={() => setShowDelete(false)}
          onDeleted={() => { setShowDelete(false); onClose(); onChanged(); }}
        />
      )}
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-gray-500 shrink-0">{label}</span>
      <span className="font-medium text-gray-900 text-right">{value}</span>
    </div>
  );
}
