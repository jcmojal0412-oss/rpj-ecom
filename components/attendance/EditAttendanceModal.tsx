'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import type { EventType } from '@/lib/attendance';

const LABELS: Record<EventType, string> = {
  TIME_IN: 'Time In', LUNCH_OUT: 'Lunch Out', LUNCH_IN: 'Lunch In',
  COFFEE_OUT: 'Coffee Out', COFFEE_IN: 'Coffee In', TIME_OUT: 'Time Out',
};
const ORDER: EventType[] = ['TIME_IN', 'COFFEE_OUT', 'COFFEE_IN', 'LUNCH_OUT', 'LUNCH_IN', 'TIME_OUT'];
const SINGLES: EventType[] = ['TIME_IN', 'LUNCH_OUT', 'LUNCH_IN', 'TIME_OUT'];

interface Row { key: string; id?: number; type: EventType; time: string }

let seq = 0;
const nextKey = () => `p${++seq}`;
const phHHMM = (iso: string) => new Date(new Date(iso).getTime() + 8 * 3600 * 1000).toISOString().slice(11, 16);

interface Props {
  employeeId: number;
  employeeName: string;
  date: string;
  onClose: () => void;
  onSaved: (note?: string) => void;
}

export default function EditAttendanceModal({ employeeId, employeeName, date, onClose, onSaved }: Props) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/attendance/day-events?employee_id=${employeeId}&date=${date}`)
      .then(r => r.json())
      .then(d => {
        const evs: { id: number; event_type: EventType; event_time: string }[] = Array.isArray(d.events) ? d.events : [];
        setRows(evs.map(e => ({ key: nextKey(), id: e.id, type: e.event_type, time: phHHMM(e.event_time) })));
      })
      .catch(() => setRows([]));
  }, [employeeId, date]);

  const update = (key: string, patch: Partial<Row>) => setRows(rs => (rs ?? []).map(r => r.key === key ? { ...r, ...patch } : r));
  const remove = (key: string) => setRows(rs => (rs ?? []).filter(r => r.key !== key));
  const add = (type: EventType) => setRows(rs => [...(rs ?? []), { key: nextKey(), type, time: '' }]);

  const list = rows ?? [];
  const sorted = [...list].sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99') || ORDER.indexOf(a.type) - ORDER.indexOf(b.type));
  const missingSingles = SINGLES.filter(t => !list.some(r => r.type === t));
  const canSave = rows !== null && !saving && reason.trim().length >= 3 && list.every(r => /^\d{2}:\d{2}$/.test(r.time));

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/attendance/manual-edit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: employeeId, date, reason: reason.trim(),
          punches: list.map(r => ({ id: r.id, event_type: r.type, time: r.time })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || 'Could not save the changes.'); return; }
      const bits = [data.payroll_note, ...(Array.isArray(data.ot_notes) ? data.ot_notes : [])].filter(Boolean);
      onSaved(bits.length ? bits.join(' · ') : undefined);
    } catch {
      setError('Could not save the changes.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto p-4 sm:p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Edit Attendance</h2>
          <p className="text-sm text-gray-600">{employeeName} — {formatDate(date)}</p>
        </div>

        {rows === null ? (
          <div className="flex justify-center py-8"><Loader2 className="animate-spin text-gray-300" size={22} /></div>
        ) : (
          <>
            <div className="space-y-2">
              {sorted.length === 0 && (
                <p className="text-sm text-gray-400 rounded-lg bg-gray-50 px-3 py-4 text-center">
                  No punches on this day yet. Add the Time In and Time Out below.
                </p>
              )}
              {sorted.map(r => (
                <div key={r.key} className="flex items-center gap-2">
                  <select className="form-input py-2.5 sm:py-1.5 text-sm flex-1 min-w-0" value={r.type} onChange={e => update(r.key, { type: e.target.value as EventType })}>
                    {ORDER.map(t => <option key={t} value={t}>{LABELS[t]}</option>)}
                  </select>
                  <input type="time" className="form-input py-2.5 sm:py-1.5 text-sm w-32 shrink-0" value={r.time} onChange={e => update(r.key, { time: e.target.value })} />
                  <button type="button" onClick={() => remove(r.key)} title="Remove this punch"
                    className="p-2.5 sm:p-1.5 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 shrink-0"><Trash2 size={16} /></button>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-1.5">
              {missingSingles.map(t => (
                <button key={t} type="button" onClick={() => add(t)} className="btn-secondary text-xs py-2 sm:py-1">
                  <Plus size={12} /> {LABELS[t]}
                </button>
              ))}
              <button type="button" onClick={() => add('COFFEE_OUT')} className="btn-secondary text-xs py-2 sm:py-1"><Plus size={12} /> Coffee Break</button>
            </div>

            {list.some(r => r.type === 'COFFEE_OUT') && !list.some(r => r.type === 'COFFEE_IN') && (
              <p className="text-[11px] text-gray-400">A Coffee Out needs a matching Coffee In — add one with “Coffee Break” or change the type.</p>
            )}

            <div>
              <label className="form-label">Reason for this edit *</label>
              <textarea className="form-input" rows={2} value={reason} onChange={e => setReason(e.target.value)}
                placeholder="e.g. Forgot to clock in, system was down, logged in late by mistake" />
            </div>

            <p className="text-[11px] text-gray-400">
              Nothing is deleted — the old times are kept in the audit log with your name and reason. Overtime and any open payroll are updated automatically.
            </p>
          </>
        )}

        {error && <p className="text-xs text-red-600 font-medium">{error}</p>}

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 [&>button]:justify-center [&>button]:py-2.5 sm:[&>button]:py-2">
          <button onClick={onClose} disabled={saving} className="btn-secondary">Cancel</button>
          <button onClick={save} disabled={!canSave} className="btn-primary disabled:opacity-40">
            {saving ? <Loader2 size={14} className="animate-spin" /> : null}{saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
