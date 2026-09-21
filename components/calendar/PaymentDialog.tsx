'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { peso } from '@/lib/calendar';
import { PAYMENT_METHODS, type CalEvent } from './calendar-ui';

// "Mark as Paid" (covers the whole remaining balance) or "Add Partial Payment".
// For a collection the same dialog says Received. The original due date is never touched.
export default function PaymentDialog({ event, mode, today, onClose, onDone }: { event: CalEvent; mode: 'paid' | 'partial'; today: string; onClose: () => void; onDone: (warning?: string) => void }) {
  const collection = event.financial_type === 'COLLECTION';
  const full = mode === 'paid';
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState(full ? String(event.remaining) : '');
  const [method, setMethod] = useState(event.payment_method ?? '');
  const [ref, setRef] = useState('');
  const [remarks, setRemarks] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const noun = collection ? 'collection' : 'payment';
  const title = full ? (collection ? 'Mark as Received' : 'Mark as Paid') : (collection ? 'Add Partial Collection' : 'Add Partial Payment');
  const paidNow = Number(amount);
  const leftAfter = Number.isFinite(paidNow) ? Math.max(0, Math.round((event.remaining - paidNow) * 100) / 100) : event.remaining;

  const save = async () => {
    setBusy(true); setError('');
    try {
      const res = await fetch(`/api/calendar/events/${event.id}/payments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_date: date, amount: full ? event.remaining : Number(amount), payment_method: method, reference_no: ref, remarks, mark_as_paid: full }),
      });
      const j = await res.json();
      if (!res.ok) { setError(j.error || 'Could not record this.'); return; }
      if (file) {
        const fd = new FormData();
        fd.append('file', file); fd.append('kind', 'receipt'); fd.append('payment_id', String(j.payment_id));
        const up = await fetch(`/api/calendar/events/${event.id}/attachments`, { method: 'POST', body: fd });
        if (!up.ok) {
          // The payment itself is saved; only the file failed. Say so plainly and let them retry from the details screen.
          const uj = await up.json().catch(() => ({}));
          onDone(`The ${noun} was saved, but the receipt was not: ${uj.error || 'upload failed'}. Add it again from the schedule details.`);
          return;
        }
      }
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={() => !busy && onClose()} title={title} size="md">
      <div className="space-y-4">
        <div className="rounded-xl bg-gray-50 border border-gray-100 p-3 text-sm">
          <p className="font-semibold text-gray-900 break-words">{event.event_title}</p>
          <p className="text-gray-500 mt-0.5">Total {peso(event.amount ?? 0)} · {collection ? 'received' : 'paid'} {peso(event.paid)} · <span className="font-semibold text-gray-800">balance {peso(event.remaining)}</span></p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="form-label" htmlFor="pay-date">{collection ? 'Date received' : 'Payment date'} *</label>
            <input id="pay-date" type="date" className="form-input" max={today} value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div>
            <label className="form-label" htmlFor="pay-amt">{collection ? 'Amount received' : 'Amount paid'} (₱) *</label>
            <input id="pay-amt" type="number" min="0" step="0.01" className="form-input" value={full ? String(event.remaining) : amount} readOnly={full} onChange={e => setAmount(e.target.value)} />
            {full ? <p className="text-[11px] text-gray-400 mt-1">Covers the full balance. Use “Add Partial {collection ? 'Collection' : 'Payment'}” for less.</p>
              : <p className="text-[11px] text-gray-400 mt-1">Balance after this: <span className="font-semibold">{peso(leftAfter)}</span></p>}
          </div>
          <div>
            <label className="form-label" htmlFor="pay-method">Payment method</label>
            <select id="pay-method" className="form-input" value={method} onChange={e => setMethod(e.target.value)}><option value="">—</option>{PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}</select>
          </div>
          <div>
            <label className="form-label" htmlFor="pay-ref">Reference number</label>
            <input id="pay-ref" className="form-input" value={ref} onChange={e => setRef(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="form-label" htmlFor="pay-remarks">Remarks</label>
          <textarea id="pay-remarks" className="form-input" rows={2} value={remarks} onChange={e => setRemarks(e.target.value)} />
        </div>
        <div>
          <label className="form-label" htmlFor="pay-file">Receipt (optional)</label>
          <input id="pay-file" type="file" className="text-sm max-w-full" accept="image/*,application/pdf" onChange={e => setFile(e.target.files?.[0] ?? null)} />
        </div>
        {error && <p className="text-sm text-red-600 font-medium" role="alert">{error}</p>}
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 [&>button]:justify-center">
          <button className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn-primary disabled:opacity-50" onClick={save} disabled={busy}>{busy && <Loader2 size={14} className="animate-spin" />}{full ? (collection ? 'Confirm Received' : 'Confirm Paid') : `Save ${collection ? 'Collection' : 'Payment'}`}</button>
        </div>
      </div>
    </Modal>
  );
}
