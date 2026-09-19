'use client';

import { useState } from 'react';
import { formatCurrency } from '@/lib/utils';
import { COUNT_REASONS } from './constants';

interface CountItem { id: number; sku: string; name: string; quantity: number; cogs: number; }

interface Props {
  item: CountItem;
  onCancel: () => void;
  onSaved: (result: { variance: number }) => void;
}

export default function PhysicalCountModal({ item, onCancel, onSaved }: Props) {
  const [expected, setExpected] = useState(item.quantity);
  const [counted, setCounted] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const countedNum = counted.trim() === '' ? null : Number(counted);
  const valid = countedNum !== null && Number.isInteger(countedNum) && countedNum >= 0;
  const variance = valid ? (countedNum as number) - expected : 0;
  const varianceValue = variance * (item.cogs || 0);
  const needsReason = valid && variance !== 0;
  const reasonOk = !needsReason || (COUNT_REASONS.includes(reason) && (reason !== 'Other' || note.trim() !== ''));
  const canSave = valid && reasonOk && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/inventory', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: item.id, quantity: countedNum, expected_quantity: expected,
          reason: needsReason ? reason : undefined, note: note.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Stock moved while the counter was counting — show the fresh
        // number and make them recount rather than adjusting against a
        // figure that's no longer true.
        if (res.status === 409 && typeof data.current === 'number') {
          setExpected(data.current);
          setCounted('');
        }
        setError(data.error || 'Failed to save the count.');
        return;
      }
      onSaved({ variance: data.variance });
    } catch {
      setError('Failed to save the count.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold text-gray-900">{item.name}</p>
        <p className="text-xs text-gray-400 font-mono">{item.sku}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-gray-50 p-3">
          <p className="text-[11px] text-gray-500 font-medium">System says</p>
          <p className="text-2xl font-bold text-gray-900 tabular-nums">{expected}</p>
        </div>
        <div>
          <label className="text-[11px] text-gray-500 font-medium">Actual count</label>
          <input
            type="number" inputMode="numeric" min={0} step={1} autoFocus
            className="form-input text-lg font-bold tabular-nums mt-1 min-h-[52px]"
            placeholder="0" value={counted} onChange={e => setCounted(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') save(); }}
          />
        </div>
      </div>

      {valid && (
        variance === 0 ? (
          <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800 font-medium">
            Matches the system — no adjustment needed. The count is still recorded.
          </div>
        ) : (
          <div className={`rounded-lg border px-3 py-2 text-sm font-medium ${variance < 0 ? 'bg-red-50 border-red-200 text-red-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
            {variance < 0 ? 'Short' : 'Over'} by {Math.abs(variance)} pc{Math.abs(variance) === 1 ? '' : 's'}
            {item.cogs > 0 && <> ({variance < 0 ? '−' : '+'}{formatCurrency(Math.abs(varianceValue))} at cost)</>}
          </div>
        )
      )}

      {needsReason && (
        <>
          <div>
            <label className="text-[11px] text-gray-500 font-medium">Reason for the difference *</label>
            <select className="form-input mt-1 min-h-[44px]" value={reason} onChange={e => setReason(e.target.value)}>
              <option value="">Select a reason…</option>
              {COUNT_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] text-gray-500 font-medium">Note{reason === 'Other' ? ' *' : ' (optional)'}</label>
            <input className="form-input mt-1 min-h-[44px]" placeholder="Anything worth remembering" value={note} onChange={e => setNote(e.target.value)} />
          </div>
        </>
      )}

      {error && <p className="text-xs text-red-600 font-medium">{error}</p>}

      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        <button onClick={onCancel} disabled={saving} className="btn-secondary justify-center min-h-[44px] sm:min-h-0">Cancel</button>
        <button onClick={save} disabled={!canSave} className="btn-primary justify-center min-h-[44px] sm:min-h-0 disabled:opacity-40">
          {saving ? 'Saving...' : 'Save Count'}
        </button>
      </div>
    </div>
  );
}
