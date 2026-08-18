'use client';

import { useState } from 'react';
import { todayISO } from '@/lib/utils';
import { MARKETING_CATEGORIES, type MarketingExpense } from '@/lib/service-center-marketing';

interface Props {
  initial?: MarketingExpense;
  onSuccess: () => void;
  onCancel: () => void;
}

export default function AddMarketingExpenseModal({ initial, onSuccess, onCancel }: Props) {
  const [expenseDate, setExpenseDate]   = useState(initial?.expense_date?.slice(0, 10) ?? todayISO());
  const [category, setCategory]         = useState(initial?.category ?? MARKETING_CATEGORIES[0]);
  const [amount, setAmount]             = useState(initial?.amount ? String(initial.amount) : '');
  const [description, setDescription]   = useState(initial?.description ?? '');
  const [reference, setReference]       = useState(initial?.reference ?? '');
  const [submitting, setSubmitting]     = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const body = {
        expense_date: expenseDate,
        category,
        amount: parseFloat(amount) || 0,
        description: description.trim() || null,
        reference: reference.trim() || null,
      };
      const url = initial ? `/api/service-center/marketing-expenses/${initial.id}` : '/api/service-center/marketing-expenses';
      const method = initial ? 'PUT' : 'POST';
      await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      onSuccess();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="form-label">Date *</label>
          <input type="date" className="form-input" value={expenseDate} onChange={e => setExpenseDate(e.target.value)} required />
        </div>
        <div>
          <label className="form-label">Amount (₱) *</label>
          <input type="number" step="0.01" min="0.01" className="form-input" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} required />
        </div>

        <div className="col-span-2">
          <label className="form-label">Category *</label>
          <select className="form-input" value={category} onChange={e => setCategory(e.target.value)}>
            {MARKETING_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div className="col-span-2">
          <label className="form-label">Description / Notes</label>
          <input className="form-input" placeholder="e.g. Service Center Repair Campaign" value={description} onChange={e => setDescription(e.target.value)} />
        </div>

        <div className="col-span-2">
          <label className="form-label">Reference</label>
          <input className="form-input" placeholder="Optional — receipt no., ad ID, etc." value={reference} onChange={e => setReference(e.target.value)} />
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onCancel} className="btn-secondary">Cancel</button>
        <button type="submit" disabled={submitting || !amount || !expenseDate} className="btn-primary disabled:opacity-50">
          {submitting ? 'Saving...' : initial ? 'Update Expense' : 'Add Expense'}
        </button>
      </div>
    </form>
  );
}
