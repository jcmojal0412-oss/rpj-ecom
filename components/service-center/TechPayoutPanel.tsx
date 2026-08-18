'use client';

import { useEffect, useState, useMemo } from 'react';
import { Loader2, Wallet, History } from 'lucide-react';
import { formatCurrency, formatDate, todayISO } from '@/lib/utils';
import { Toast, useToast } from '@/components/ui/Toast';
import Modal from '@/components/ui/Modal';
import RepairDetailsDrawer from './RepairDetailsDrawer';
import type { Repair } from './types';
import { PAYOUT_STATUS_COLOR } from './types';

interface PayoutHistoryRow {
  id: number; repair_id: number; amount: number; payment_date: string; payment_method: string | null;
  reference_notes: string | null; processed_by_name: string | null; repair_details: string | null;
  unit_model: string | null; technician_name: string | null;
}

const PAYMENT_METHODS = ['Cash', 'GCash', 'Bank Transfer', 'Other'];

export default function TechPayoutPanel() {
  const [repairs, setRepairs] = useState<Repair[]>([]);
  const [history, setHistory] = useState<PayoutHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'payable' | 'history'>('payable');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showPayModal, setShowPayModal] = useState(false);
  const [drawerId, setDrawerId] = useState<number | null>(null);
  const { toast, showToast, clearToast } = useToast();

  const fetchAll = () => {
    setLoading(true);
    Promise.all([
      fetch('/api/service-repairs').then(r => r.json()),
      fetch('/api/service-repairs/tech-payouts').then(r => r.json()),
    ]).then(([repairsData, historyData]) => {
      setRepairs(repairsData.rows ?? []);
      setHistory(historyData.rows ?? []);
      setLoading(false);
    });
  };
  useEffect(fetchAll, []);

  const payable = useMemo(
    () => repairs.filter(r => r.tech_payable > 0.005).sort((a, b) => b.repair_date.localeCompare(a.repair_date)),
    [repairs]
  );

  const toggle = (id: number, due: boolean) => {
    if (!due) return;
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectedTotal = payable.filter(r => selected.has(r.id)).reduce((s, r) => s + r.tech_payable, 0);

  return (
    <div className="min-h-screen bg-[#F6F8FC] p-4 sm:p-6 space-y-6 pb-24">
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}

      <div>
        <h1 className="text-[28px] font-bold text-[#16233B]">Technician Payouts</h1>
        <p className="text-sm text-[#66758A] mt-1">Independent from customer payment — pays out technician earnings on completed jobs.</p>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => setView('payable')}
          className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${view === 'payable' ? 'bg-[#233653] text-white' : 'bg-[#F0F3F8] text-[#66758A] hover:bg-[#E5EAF0]'}`}
        >
          <Wallet size={13} /> Payable
        </button>
        <button
          onClick={() => setView('history')}
          className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${view === 'history' ? 'bg-[#233653] text-white' : 'bg-[#F0F3F8] text-[#66758A] hover:bg-[#E5EAF0]'}`}
        >
          <History size={13} /> View Payout History
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-300" size={24} /></div>
      ) : view === 'payable' ? (
        <div className="bg-white border border-[#E5EAF0] rounded-xl overflow-hidden">
          {payable.length === 0 ? (
            <p className="text-sm text-[#94A2B4] text-center py-12">✅ Nothing payable to technicians right now.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#E5EAF0] text-left text-xs text-[#66758A]">
                    <th className="px-4 py-3 font-medium w-8"></th>
                    <th className="px-4 py-3 font-medium">Repair Job</th>
                    <th className="px-4 py-3 font-medium whitespace-nowrap">Technician</th>
                    <th className="px-4 py-3 font-medium whitespace-nowrap">Repair Date</th>
                    <th className="px-4 py-3 font-medium text-right whitespace-nowrap">Tech Earnings</th>
                    <th className="px-4 py-3 font-medium whitespace-nowrap">Payout Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0F3F8]">
                  {payable.map(r => {
                    const due = r.tech_payout_status === 'Due';
                    return (
                      <tr key={r.id} className={`hover:bg-[#F6F8FC] ${!due ? 'opacity-50' : ''}`}>
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selected.has(r.id)}
                            disabled={!due}
                            onChange={() => toggle(r.id, due)}
                            className="w-4 h-4 text-[#233653] rounded border-gray-300 focus:ring-[#B68B3C] disabled:opacity-40"
                          />
                        </td>
                        <td className="px-4 py-3 cursor-pointer" onClick={() => setDrawerId(r.id)}>
                          <p className="font-medium text-[#16233B]">{r.repair_details || '—'}</p>
                          {r.unit_model && <p className="text-xs text-[#94A2B4]">{r.unit_model}</p>}
                        </td>
                        <td className="px-4 py-3 text-[#66758A] whitespace-nowrap">{r.technician_name || '—'}</td>
                        <td className="px-4 py-3 text-[#66758A] whitespace-nowrap">{formatDate(r.repair_date)}</td>
                        <td className="px-4 py-3 text-right font-semibold text-amber-700 whitespace-nowrap">{formatCurrency(r.tech_payable)}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${PAYOUT_STATUS_COLOR[r.tech_payout_status]}`}>{r.tech_payout_status}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white border border-[#E5EAF0] rounded-xl overflow-hidden">
          {history.length === 0 ? (
            <p className="text-sm text-[#94A2B4] text-center py-12">No payouts recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#E5EAF0] text-left text-xs text-[#66758A]">
                    <th className="px-4 py-3 font-medium whitespace-nowrap">Date</th>
                    <th className="px-4 py-3 font-medium">Repair Job</th>
                    <th className="px-4 py-3 font-medium whitespace-nowrap">Technician</th>
                    <th className="px-4 py-3 font-medium text-right whitespace-nowrap">Amount</th>
                    <th className="px-4 py-3 font-medium whitespace-nowrap">Method</th>
                    <th className="px-4 py-3 font-medium whitespace-nowrap">Processed By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0F3F8]">
                  {history.map(h => (
                    <tr key={h.id} className="hover:bg-[#F6F8FC] cursor-pointer" onClick={() => setDrawerId(h.repair_id)}>
                      <td className="px-4 py-3 text-[#16233B] whitespace-nowrap">{formatDate(h.payment_date)}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-[#16233B]">{h.repair_details || '—'}</p>
                        {h.unit_model && <p className="text-xs text-[#94A2B4]">{h.unit_model}</p>}
                      </td>
                      <td className="px-4 py-3 text-[#66758A] whitespace-nowrap">{h.technician_name || '—'}</td>
                      <td className="px-4 py-3 text-right font-semibold text-amber-700 whitespace-nowrap">{formatCurrency(h.amount)}</td>
                      <td className="px-4 py-3 text-[#66758A] whitespace-nowrap">{h.payment_method || '—'}</td>
                      <td className="px-4 py-3 text-[#94A2B4] text-xs whitespace-nowrap">{h.processed_by_name || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {selected.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 sm:left-[240px] bg-white border-t border-[#E5EAF0] px-6 py-4 flex items-center justify-between shadow-[0_-4px_12px_rgba(16,35,59,0.06)] z-30">
          <span className="text-sm text-[#66758A]">{selected.size} repair{selected.size === 1 ? '' : 's'} selected</span>
          <button
            onClick={() => setShowPayModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#B68B3C] hover:bg-[#9c7530] text-white text-sm font-semibold rounded-lg transition-colors"
          >
            <Wallet size={16} /> Pay Selected ({selected.size}) • {formatCurrency(selectedTotal)}
          </button>
        </div>
      )}

      {showPayModal && (
        <Modal open={showPayModal} onClose={() => setShowPayModal(false)} title="Pay Selected Technicians" size="md">
          <PayoutModal
            count={selected.size}
            total={selectedTotal}
            onCancel={() => setShowPayModal(false)}
            onSaved={() => { setShowPayModal(false); setSelected(new Set()); showToast('Technician payout recorded!'); fetchAll(); }}
            repairIds={[...selected]}
          />
        </Modal>
      )}

      {drawerId != null && (
        <RepairDetailsDrawer repairId={drawerId} onClose={() => setDrawerId(null)} onChanged={fetchAll} />
      )}
    </div>
  );
}

function PayoutModal({ count, total, repairIds, onCancel, onSaved }: {
  count: number; total: number; repairIds: number[]; onCancel: () => void; onSaved: () => void;
}) {
  const [date, setDate] = useState(todayISO());
  const [method, setMethod] = useState(PAYMENT_METHODS[0]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/service-repairs/tech-payouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repair_ids: repairIds, payment_date: date, payment_method: method, reference_notes: notes || null }),
      });
      if (res.ok) {
        onSaved();
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body.error || 'Failed to record payout.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {error && <div className="text-xs font-medium text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}
      <div className="bg-[#F6F8FC] border border-[#E5EAF0] rounded-lg p-3 text-sm flex justify-between">
        <span className="text-[#66758A]">{count} repair{count === 1 ? '' : 's'} selected</span>
        <span className="font-bold text-[#16233B]">{formatCurrency(total)}</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
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
        <div className="col-span-2">
          <label className="form-label">Reference / Notes</label>
          <input className="form-input" placeholder="e.g. Weekly payout" value={notes} onChange={e => setNotes(e.target.value)} />
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="btn-secondary">Cancel</button>
        <button onClick={handleSave} disabled={saving} className="btn-primary disabled:opacity-50">
          {saving ? <Loader2 size={14} className="animate-spin" /> : null}
          {saving ? 'Saving...' : `Pay ${formatCurrency(total)}`}
        </button>
      </div>
    </div>
  );
}
