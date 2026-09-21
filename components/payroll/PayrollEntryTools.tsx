'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { formatCurrency } from '@/lib/utils';

type ShowToast = (m: string, t?: 'success' | 'error') => void;

interface Candidate {
  id: number; full_name: string; department: string | null; pay_basis: string; salary_type: string;
  basic_rate: number; per_cutoff: number | null; in_other_run: string | null;
}

// "Add employee to this payroll run": for someone who was not in the run when
// it was generated (a new hire, a freelancer, a fixed-rate employee). The
// server builds the entry with the same function payroll generation uses.
export function AddEmployeeToRunModal({ periodId, onClose, onAdded, showToast }: { periodId: number; onClose: () => void; onAdded: () => void; showToast: ShowToast }) {
  const [list, setList] = useState<Candidate[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    fetch(`/api/payroll/periods/${periodId}/entries`).then(async r => {
      const d = await r.json();
      if (!alive) return;
      if (!r.ok) setLoadError(d.error || 'Could not load employees.'); else setList(d.available);
    }).catch(() => alive && setLoadError('Could not load employees.'));
    return () => { alive = false; };
  }, [periodId]);

  const selected = list?.find(c => String(c.id) === employeeId) ?? null;
  const fixed = selected?.pay_basis === 'fixed';

  const submit = async () => {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/payroll/periods/${periodId}/entries`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: selected.id, ...(fixed && amount.trim() ? { amount: Number(amount) } : {}) }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error || 'Could not add this employee.'); return; }
      showToast(`${selected.full_name} added to the payroll run.`);
      onAdded();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={() => !busy && onClose()} title="Add employee to this payroll run" size="md">
      {loadError ? <p className="text-sm text-red-600">{loadError}</p> : !list ? (
        <div className="flex justify-center py-10"><Loader2 className="animate-spin text-gray-300" size={22} /></div>
      ) : list.length === 0 ? (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">Every Active employee is already in this payroll run.</p>
          <div className="flex justify-end"><button onClick={onClose} className="btn-secondary">Close</button></div>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="form-label" htmlFor="add-emp">Employee</label>
            <select id="add-emp" className="form-input" value={employeeId} onChange={e => { setEmployeeId(e.target.value); setAmount(''); setError(''); }}>
              <option value="">Choose an employee…</option>
              {list.map(c => (
                <option key={c.id} value={c.id} disabled={!!c.in_other_run}>
                  {c.full_name}{c.department ? ` · ${c.department}` : ''} · {c.pay_basis === 'fixed' ? `Fixed ${formatCurrency(c.basic_rate)}/month` : c.salary_type}{c.in_other_run ? ' — already in another run' : ''}
                </option>
              ))}
            </select>
          </div>

          {selected && fixed && (
            <div className="space-y-3">
              <p className="text-sm text-gray-700 rounded-lg bg-gray-50 border border-gray-100 px-3 py-2.5">
                Fixed-rate employee (no time in / out). Paid <b>{formatCurrency(selected.per_cutoff ?? 0)}</b> this cutoff — half of {formatCurrency(selected.basic_rate)} a month.
              </p>
              <div>
                <label className="form-label" htmlFor="add-amount">Different amount for this run (optional)</label>
                <input id="add-amount" type="number" min="0" step="0.01" className="form-input" placeholder={selected.per_cutoff ? String(selected.per_cutoff) : 'Amount'} value={amount} onChange={e => setAmount(e.target.value)} />
                <p className="text-xs text-gray-400 mt-1">Leave blank to use the fixed rate. Bonuses and deductions can be added afterwards.</p>
              </div>
            </div>
          )}
          {selected && !fixed && (
            <p className="text-sm text-gray-700 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5">
              Paid from attendance like everyone else in this run: their time in / out, late, undertime and absences for these dates are counted. If they did not clock in, they are counted absent.
            </p>
          )}

          {error && <p className="text-xs text-red-600 font-medium">{error}</p>}
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 [&>button]:justify-center">
            <button onClick={onClose} disabled={busy} className="btn-secondary">Cancel</button>
            <button onClick={submit} disabled={busy || !selected} className="btn-primary disabled:opacity-50">
              {busy ? <Loader2 size={14} className="animate-spin" /> : null} Add to Payroll Run
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// Shown in an employee's pay detail while the run is still being prepared:
// change this run's amount (fixed-rate only) or take them out of the run.
export function EntryManage({ entry, onChanged, onRemoved, showToast }: { entry: any; onChanged: () => void; onRemoved: () => void; showToast: ShowToast }) {
  const fixed = entry.pay_basis_snapshot === 'fixed';
  const [amount, setAmount] = useState(entry.basic_pay_override != null ? String(entry.basic_pay_override) : '');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const saveAmount = async (value: number | null) => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/payroll/entries/${entry.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: value }) });
      const d = await res.json();
      if (!res.ok) { setError(d.error || 'Could not change the amount.'); return; }
      if (value === null) setAmount('');
      showToast(value === null ? 'Back to the fixed rate.' : 'Amount for this run saved.');
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/payroll/entries/${entry.id}`, { method: 'DELETE' });
      const d = await res.json();
      if (!res.ok) { setError(d.error || 'Could not remove this employee.'); setConfirming(false); return; }
      showToast(`${entry.employee_name_snapshot} removed from this payroll run.`);
      onRemoved();
    } finally {
      setBusy(false);
    }
  };

  const defaultAmount = Math.round((entry.basic_rate_snapshot / 2) * 100) / 100;
  return (
    <div className="rounded-xl border border-gray-100 p-3.5 space-y-3 text-sm">
      {fixed && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Fixed-rate pay for this run</p>
          <div className="mt-1.5 flex flex-col sm:flex-row gap-2">
            <input type="number" min="0" step="0.01" aria-label="Amount for this run" className="form-input sm:max-w-[180px]" placeholder={String(defaultAmount)} value={amount} onChange={e => setAmount(e.target.value)} />
            <button onClick={() => saveAmount(Number(amount))} disabled={busy || !amount.trim() || Number(amount) === entry.basic_pay_override} className="btn-secondary text-xs disabled:opacity-40 justify-center">Save amount</button>
            {entry.basic_pay_override != null && <button onClick={() => saveAmount(null)} disabled={busy} className="text-xs text-orange-600 hover:text-orange-800 px-2 py-2">Use fixed rate ({formatCurrency(defaultAmount)})</button>}
          </div>
        </div>
      )}
      {!confirming ? (
        <button onClick={() => setConfirming(true)} className="text-xs font-medium text-red-600 hover:text-red-800">Remove from this payroll run</button>
      ) : (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 space-y-2">
          <p className="text-xs text-red-800">Remove <b>{entry.employee_name_snapshot}</b> from this payroll run? Their pay and any bonuses or deductions on it are deleted from this run. You can add them again later.</p>
          <div className="flex gap-2">
            <button onClick={() => setConfirming(false)} disabled={busy} className="btn-secondary text-xs">Cancel</button>
            <button onClick={remove} disabled={busy} className="text-xs font-semibold px-3 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">Yes, remove</button>
          </div>
        </div>
      )}
      {error && <p className="text-xs text-red-600 font-medium">{error}</p>}
    </div>
  );
}
