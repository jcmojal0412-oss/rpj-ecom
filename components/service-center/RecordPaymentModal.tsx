'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { formatCurrency, todayISO } from '@/lib/utils';
import type { Repair } from './types';

const PAYMENT_METHODS = ['Cash', 'GCash', 'Bank Transfer', 'Other'];

export default function RecordPaymentModal({ repair, onCancel, onSaved }: {
  repair: Repair; onCancel: () => void; onSaved: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [method, setMethod] = useState(PAYMENT_METHODS[0]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountNum = parseFloat(amount) || 0;
  const newTotal = repair.collected + amountNum;
  const remaining = Math.max(0, repair.repair_amount - newTotal);
  const exceeds = amountNum > repair.balance + 0.005;

  const canSave = amountNum > 0 && !exceeds;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/service-repairs/${repair.id}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amountNum, payment_date: date, payment_method: method, reference_notes: notes || null }),
      });
      if (res.ok) {
        onSaved();
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body.error || 'Failed to record payment.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {error && <div className="text-xs font-medium text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}

      <div className="bg-[#F6F8FC] border border-[#E5EAF0] rounded-lg p-3 text-sm space-y-1">
        <div className="flex justify-between"><span className="text-[#66758A]">Repair Amount</span><span className="font-semibold text-[#16233B]">{formatCurrency(repair.repair_amount)}</span></div>
        <div className="flex justify-between"><span className="text-[#66758A]">Previously Paid</span><span className="font-semibold text-[#16233B]">{formatCurrency(repair.collected)}</span></div>
        <div className="flex justify-between"><span className="text-[#66758A]">New Payment</span><span className="font-semibold text-green-700">{formatCurrency(amountNum)}</span></div>
        <div className="flex justify-between border-t border-[#E5EAF0] pt-1 mt-1"><span className="text-[#66758A]">Total Collected</span><span className="font-bold text-[#16233B]">{formatCurrency(newTotal)}</span></div>
        <div className="flex justify-between"><span className="text-[#66758A]">Remaining Balance</span><span className="font-bold text-[#16233B]">{formatCurrency(remaining)}</span></div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="form-label">Payment Amount (₱)</label>
          <input type="number" min="0.01" step="0.01" className="form-input" value={amount} onChange={e => setAmount(e.target.value)} autoFocus />
          {exceeds && <p className="text-xs text-red-600 mt-1">Cannot exceed the remaining balance of {formatCurrency(repair.balance)}.</p>}
        </div>
        <div>
          <label className="form-label">Payment Date</label>
          <input type="date" className="form-input" value={date} max={todayISO()} onChange={e => setDate(e.target.value)} />
        </div>
        <div>
          <label className="form-label">Payment Method</label>
          <select className="form-input" value={method} onChange={e => setMethod(e.target.value)}>
            {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="form-label">Reference / Notes</label>
          <input className="form-input" placeholder="e.g. GCash ref #" value={notes} onChange={e => setNotes(e.target.value)} />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="btn-secondary">Cancel</button>
        <button onClick={handleSave} disabled={saving || !canSave} className="btn-primary disabled:opacity-50">
          {saving ? <Loader2 size={14} className="animate-spin" /> : null}
          {saving ? 'Saving...' : 'Record Payment'}
        </button>
      </div>
    </div>
  );
}
