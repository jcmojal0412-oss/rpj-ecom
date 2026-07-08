'use client';

import { useEffect, useState, useCallback } from 'react';
import { Plus, Eye, Trash2, Wrench, Banknote, PiggyBank, Users2 } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Toast, useToast } from '@/components/ui/Toast';
import Modal from '@/components/ui/Modal';
import Spinner from '@/components/ui/Spinner';
import RepairForm from './RepairForm';

export interface Repair {
  id: number; repair_date: string; repair_details: string | null; unit_model: string | null;
  cs_payment: number; cogs: number; labor_amount: number;
  bns_share: number; gerald_share: number; dp: number;
  status: 'ONGOING' | 'CUSTOMER PAID'; paid_to_tech: number; tech_paid_date: string | null;
}

interface Totals {
  total_cs_payment: number; total_cogs: number; total_labor: number;
  total_bns: number; total_gerald: number; total_dp: number;
  ongoing_count: number; gerald_unpaid: number;
}

export default function ServiceCenterClient() {
  const [repairs, setRepairs] = useState<Repair[]>([]);
  const [totals, setTotals]   = useState<Totals | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing]   = useState<Repair | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');
  const { toast, showToast, clearToast } = useToast();

  const fetchData = useCallback(async () => {
    setLoading(true);
    const data = await fetch('/api/service-repairs').then(r => r.json());
    setRepairs(data.rows ?? []);
    setTotals(data.totals ?? null);
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = repairs.filter(r => {
    const d = r.repair_date ? r.repair_date.slice(0, 10) : '';
    if (dateFrom && d < dateFrom) return false;
    if (dateTo   && d > dateTo)   return false;
    return true;
  });

  const handleDelete = async (r: Repair) => {
    if (!confirm(`Delete repair entry "${r.repair_details ?? r.unit_model}"? This cannot be undone.`)) return;
    await fetch(`/api/service-repairs/${r.id}`, { method: 'DELETE' });
    showToast('Repair entry deleted');
    fetchData();
  };

  const statusBadge = (s: string) =>
    s === 'CUSTOMER PAID' ? <span className="badge-green">Customer Paid</span> : <span className="badge-amber">Ongoing</span>;

  const HEADERS = ['Date', 'Repair Details', 'Unit/Model', 'CS Payment', 'COGS', 'Labor', 'BNS', 'Gerald', 'DP', 'Status', 'Tech Paid', 'Actions'];

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Service Center Monitoring</h1>
          <p className="text-sm text-gray-500 mt-1">Track repair jobs, costs, and technician revenue split</p>
        </div>
        <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary">
          <Plus size={16} /> Add Repair
        </button>
      </div>

      {/* Summary cards */}
      {totals && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="card flex items-center gap-4">
            <div className="p-3 rounded-xl bg-blue-50"><Banknote className="text-blue-500" size={22} /></div>
            <div>
              <p className="text-xs text-gray-500 font-medium">Total CS Payment</p>
              <p className="text-xl font-bold text-gray-900 mt-0.5">{formatCurrency(totals.total_cs_payment)}</p>
            </div>
          </div>
          <div className="card flex items-center gap-4">
            <div className="p-3 rounded-xl bg-green-50"><PiggyBank className="text-green-600" size={22} /></div>
            <div>
              <p className="text-xs text-gray-500 font-medium">Total Labor Amount</p>
              <p className="text-xl font-bold text-gray-900 mt-0.5">{formatCurrency(totals.total_labor)}</p>
            </div>
          </div>
          <div className="card flex items-center gap-4">
            <div className="p-3 rounded-xl bg-amber-50"><Users2 className="text-amber-600" size={22} /></div>
            <div>
              <p className="text-xs text-gray-500 font-medium">BNS / Gerald Share</p>
              <p className="text-lg font-bold text-gray-900 mt-0.5">{formatCurrency(totals.total_bns)} / {formatCurrency(totals.total_gerald)}</p>
            </div>
          </div>
          <div className="card flex items-center gap-4">
            <div className="p-3 rounded-xl bg-red-50"><Wrench className="text-red-500" size={22} /></div>
            <div>
              <p className="text-xs text-gray-500 font-medium">Ongoing / Unpaid to Tech</p>
              <p className="text-lg font-bold text-gray-900 mt-0.5">{totals.ongoing_count} jobs · {formatCurrency(totals.gerald_unpaid)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Date filter */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-gray-500 font-medium">Filter by date:</span>
        <input type="date" className="form-input py-1.5 text-sm w-auto" value={dateFrom}
          onChange={e => setDateFrom(e.target.value)} />
        <span className="text-gray-400 text-sm">—</span>
        <input type="date" className="form-input py-1.5 text-sm w-auto" value={dateTo}
          onChange={e => setDateTo(e.target.value)} />
        {(dateFrom || dateTo) && (
          <button onClick={() => { setDateFrom(''); setDateTo(''); }}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium">
            Clear
          </button>
        )}
        {(dateFrom || dateTo) && (
          <span className="text-xs text-gray-400">{filtered.length} of {repairs.length} entries</span>
        )}
      </div>

      <div className="card">
        {loading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-400 text-sm">No repair entries yet.</p>
            <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary mt-4">
              <Plus size={16} /> Add First Repair
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  {HEADERS.map(h => <th key={h} className="table-header">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => (
                  <tr key={r.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="table-cell text-gray-500 whitespace-nowrap">{r.repair_date ? formatDate(r.repair_date) : '—'}</td>
                    <td className="table-cell font-medium">{r.repair_details || '—'}</td>
                    <td className="table-cell text-gray-600">{r.unit_model || '—'}</td>
                    <td className="table-cell font-semibold">{formatCurrency(r.cs_payment)}</td>
                    <td className="table-cell text-gray-500">{formatCurrency(r.cogs)}</td>
                    <td className="table-cell">{formatCurrency(r.labor_amount)}</td>
                    <td className="table-cell text-blue-700">{formatCurrency(r.bns_share)}</td>
                    <td className="table-cell text-amber-700">{formatCurrency(r.gerald_share)}</td>
                    <td className="table-cell text-gray-500">{r.dp ? formatCurrency(r.dp) : '—'}</td>
                    <td className="table-cell">{statusBadge(r.status)}</td>
                    <td className="table-cell">
                      {r.paid_to_tech ? <span className="badge-green">Paid</span> : <span className="badge-gray">Unpaid</span>}
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center gap-1">
                        <button onClick={() => { setEditing(r); setShowForm(true); }}
                          className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-600 transition-colors" title="Edit">
                          <Eye size={15} />
                        </button>
                        <button onClick={() => handleDelete(r)}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-500 transition-colors" title="Delete">
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={showForm} onClose={() => setShowForm(false)} title={editing ? 'Edit Repair Entry' : 'Add Repair Entry'} size="lg">
        <RepairForm
          initial={editing ?? undefined}
          onSuccess={() => { setShowForm(false); showToast(editing ? 'Repair entry updated!' : 'Repair entry added!'); fetchData(); }}
          onCancel={() => setShowForm(false)}
        />
      </Modal>
    </div>
  );
}
