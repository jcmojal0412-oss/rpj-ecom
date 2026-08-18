'use client';

import { useEffect, useState, useMemo } from 'react';
import { Plus, Loader2 } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Toast, useToast } from '@/components/ui/Toast';
import Modal from '@/components/ui/Modal';
import RecordPaymentModal from './RecordPaymentModal';
import RepairDetailsDrawer from './RepairDetailsDrawer';
import type { Repair } from './types';
import { CUSTOMER_STATUS_COLOR } from './types';

export default function CustomerCollectionPanel() {
  const [repairs, setRepairs] = useState<Repair[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [paying, setPaying] = useState<Repair | null>(null);
  const [drawerId, setDrawerId] = useState<number | null>(null);
  const { toast, showToast, clearToast } = useToast();

  const fetchData = () => {
    setLoading(true);
    fetch('/api/service-repairs').then(r => r.json()).then(d => { setRepairs(d.rows ?? []); setLoading(false); });
  };
  useEffect(fetchData, []);

  const list = useMemo(() => {
    const rows = showAll ? repairs : repairs.filter(r => r.balance > 0.005);
    return [...rows].sort((a, b) => b.balance - a.balance || b.repair_date.localeCompare(a.repair_date));
  }, [repairs, showAll]);

  const totalOutstanding = repairs.reduce((s, r) => s + r.balance, 0);
  const outstandingCount = repairs.filter(r => r.balance > 0.005).length;

  return (
    <div className="min-h-screen bg-[#F6F8FC] p-4 sm:p-6 space-y-6">
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}

      <div>
        <h1 className="text-[28px] font-bold text-[#16233B]">Customer Collections</h1>
        <p className="text-sm text-[#66758A] mt-1">
          {outstandingCount} job{outstandingCount === 1 ? '' : 's'} outstanding · {formatCurrency(totalOutstanding)} to collect
        </p>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowAll(false)}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${!showAll ? 'bg-[#233653] text-white' : 'bg-[#F0F3F8] text-[#66758A] hover:bg-[#E5EAF0]'}`}
        >
          Outstanding Only
        </button>
        <button
          onClick={() => setShowAll(true)}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${showAll ? 'bg-[#233653] text-white' : 'bg-[#F0F3F8] text-[#66758A] hover:bg-[#E5EAF0]'}`}
        >
          All Repairs
        </button>
      </div>

      <div className="bg-white border border-[#E5EAF0] rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-300" size={24} /></div>
        ) : list.length === 0 ? (
          <p className="text-sm text-[#94A2B4] text-center py-12">✅ No outstanding customer balances.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E5EAF0] text-left text-xs text-[#66758A]">
                  <th className="px-4 py-3 font-medium whitespace-nowrap">Customer</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">Date</th>
                  <th className="px-4 py-3 font-medium">Repair Job</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">Unit / Model</th>
                  <th className="px-4 py-3 font-medium text-right whitespace-nowrap">Repair Amount</th>
                  <th className="px-4 py-3 font-medium text-right whitespace-nowrap">Collected</th>
                  <th className="px-4 py-3 font-medium text-right whitespace-nowrap">Balance</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">Payment Status</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">Last Payment</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0F3F8]">
                {list.map(r => (
                  <tr key={r.id} className="hover:bg-[#F6F8FC]">
                    <td className="px-4 py-3 text-[#16233B] font-medium cursor-pointer" onClick={() => setDrawerId(r.id)}>{r.customer_name || '—'}</td>
                    <td className="px-4 py-3 text-[#66758A] whitespace-nowrap">{formatDate(r.repair_date)}</td>
                    <td className="px-4 py-3 text-[#16233B]">{r.repair_details || '—'}</td>
                    <td className="px-4 py-3 text-[#66758A] whitespace-nowrap">{r.unit_model || '—'}</td>
                    <td className="px-4 py-3 text-right font-semibold text-[#16233B] whitespace-nowrap">{formatCurrency(r.repair_amount)}</td>
                    <td className="px-4 py-3 text-right text-green-700 whitespace-nowrap">{formatCurrency(r.collected)}</td>
                    <td className="px-4 py-3 text-right text-red-600 font-semibold whitespace-nowrap">{formatCurrency(r.balance)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${CUSTOMER_STATUS_COLOR[r.customer_payment_status]}`}>{r.customer_payment_status}</span>
                    </td>
                    <td className="px-4 py-3 text-[#94A2B4] text-xs whitespace-nowrap">{r.last_payment_date ? formatDate(r.last_payment_date) : '—'}</td>
                    <td className="px-4 py-3">
                      {r.balance > 0.005 && (
                        <button
                          onClick={() => setPaying(r)}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-white bg-[#233653] hover:bg-[#1b2941] px-2.5 py-1.5 rounded-lg whitespace-nowrap"
                        >
                          <Plus size={12} /> Record Payment
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {paying && (
        <Modal open={!!paying} onClose={() => setPaying(null)} title="Record Payment" size="md">
          <RecordPaymentModal
            repair={paying}
            onCancel={() => setPaying(null)}
            onSaved={() => { setPaying(null); showToast('Payment recorded!'); fetchData(); }}
          />
        </Modal>
      )}

      {drawerId != null && (
        <RepairDetailsDrawer repairId={drawerId} onClose={() => setDrawerId(null)} onChanged={fetchData} />
      )}
    </div>
  );
}
