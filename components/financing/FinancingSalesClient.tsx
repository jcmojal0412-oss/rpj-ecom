'use client';

import { useEffect, useState } from 'react';
import { Camera, Landmark, Loader2, Pencil, Trash2 } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Toast, useToast } from '@/components/ui/Toast';
import Modal from '@/components/ui/Modal';
import FinancingScanModal from './FinancingScanModal';

const PROVIDERS = ['SKYRO', 'BILLEASE', 'SALMON', 'HOME CREDIT', 'POS TERMINAL'];
const FILTERS = ['ALL', ...PROVIDERS];

interface Sale {
  id: number;
  provider: string;
  amount: number;
  sale_date: string | null;
  customer_name: string | null;
  reference_no: string | null;
  screenshot_path: string | null;
}

const PROVIDER_BADGE: Record<string, string> = {
  SKYRO: 'bg-purple-100 text-purple-700',
  BILLEASE: 'bg-blue-100 text-blue-700',
  SALMON: 'bg-pink-100 text-pink-700',
  'HOME CREDIT': 'bg-red-100 text-red-700',
  'POS TERMINAL': 'bg-gray-100 text-gray-700',
};

export default function FinancingSalesClient() {
  const { toast, showToast, clearToast } = useToast();
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('ALL');
  const [showScan, setShowScan] = useState(false);
  const [editing, setEditing] = useState<Sale | null>(null);
  const [deleting, setDeleting] = useState<Sale | null>(null);

  const fetchSales = () => {
    setLoading(true);
    fetch('/api/financing-sales').then(r => r.json()).then(d => {
      setSales(Array.isArray(d) ? d : []);
      setLoading(false);
    });
  };

  useEffect(fetchSales, []);

  const totals = PROVIDERS.reduce<Record<string, number>>((acc, p) => {
    acc[p] = sales.filter(s => s.provider === p).reduce((sum, s) => sum + s.amount, 0);
    return acc;
  }, {});
  const grandTotal = sales.reduce((sum, s) => sum + s.amount, 0);

  const visible = filter === 'ALL' ? sales : sales.filter(s => s.provider === filter);

  const handleDelete = async () => {
    if (!deleting) return;
    const res = await fetch(`/api/financing-sales/${deleting.id}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('Sale deleted');
      setDeleting(null);
      fetchSales();
    } else {
      showToast('Failed to delete', 'error');
    }
  };

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Financing Sales</h1>
          <p className="text-sm text-gray-500 mt-1">Sales made through Skyro, Billease, Salmon, Home Credit, and POS Terminal</p>
        </div>
        <button onClick={() => setShowScan(true)} className="btn-primary">
          <Camera size={16} /> Upload Screenshot
        </button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="card flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-orange-50">
            <Landmark className="text-orange-500" size={18} />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] text-gray-500 font-medium">All Financing</p>
            <p className="text-base font-bold text-gray-900 truncate">{formatCurrency(grandTotal)}</p>
          </div>
        </div>
        {PROVIDERS.map(p => (
          <div key={p} className="card flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gray-50">
              <Landmark className="text-gray-400" size={18} />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] text-gray-500 font-medium truncate">{p}</p>
              <p className="text-base font-bold text-gray-900 truncate">{formatCurrency(totals[p] ?? 0)}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1.5 flex-wrap">
        {FILTERS.map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              filter === f ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-300" size={24} /></div>
        ) : visible.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-12">No financing sales yet. Upload a screenshot to get started.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Provider</th>
                  <th className="px-4 py-3 font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">Reference</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {visible.map(s => (
                  <tr key={s.id} className="hover:bg-gray-50/60">
                    <td className="px-4 py-3 text-gray-700">{s.sale_date ? formatDate(s.sale_date) : '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex text-[11px] font-semibold px-2 py-0.5 rounded-full ${PROVIDER_BADGE[s.provider] ?? 'bg-gray-100 text-gray-700'}`}>
                        {s.provider}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-semibold text-gray-900">{formatCurrency(s.amount)}</td>
                    <td className="px-4 py-3 text-gray-600">{s.customer_name || '—'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{s.reference_no || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setEditing(s)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => setDeleting(s)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500">
                          <Trash2 size={14} />
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

      <Modal open={showScan} onClose={() => setShowScan(false)} title="Upload Sale Screenshot" size="lg">
        <FinancingScanModal
          onClose={() => setShowScan(false)}
          onSaved={() => { setShowScan(false); showToast('Sale(s) saved!'); fetchSales(); }}
        />
      </Modal>

      {editing && (
        <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit Financing Sale" size="sm">
          <EditSaleForm
            sale={editing}
            onCancel={() => setEditing(null)}
            onSaved={() => { setEditing(null); showToast('Sale updated!'); fetchSales(); }}
          />
        </Modal>
      )}

      {deleting && (
        <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Delete Sale" size="sm">
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Delete this {deleting.provider} sale of {formatCurrency(deleting.amount)}? This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleting(null)} className="btn-secondary">Cancel</button>
              <button onClick={handleDelete} className="bg-red-500 hover:bg-red-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
                Delete
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function EditSaleForm({ sale, onCancel, onSaved }: { sale: Sale; onCancel: () => void; onSaved: () => void }) {
  const [provider, setProvider] = useState(sale.provider);
  const [amount, setAmount] = useState(String(sale.amount));
  const [date, setDate] = useState(sale.sale_date ?? '');
  const [customerName, setCustomerName] = useState(sale.customer_name ?? '');
  const [referenceNo, setReferenceNo] = useState(sale.reference_no ?? '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!amount) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/financing-sales/${sale.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider, amount: parseFloat(amount), sale_date: date || null,
          customer_name: customerName || null, reference_no: referenceNo || null,
        }),
      });
      if (res.ok) onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Financing Provider</label>
        <select className="form-input" value={provider} onChange={e => setProvider(e.target.value)}>
          {PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Amount (₱)</label>
        <input type="number" className="form-input" value={amount} onChange={e => setAmount(e.target.value)} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Date</label>
        <input type="date" className="form-input" value={date} onChange={e => setDate(e.target.value)} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Customer Name</label>
        <input type="text" className="form-input" value={customerName} onChange={e => setCustomerName(e.target.value)} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Reference No.</label>
        <input type="text" className="form-input" value={referenceNo} onChange={e => setReferenceNo(e.target.value)} />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="btn-secondary">Cancel</button>
        <button onClick={handleSave} disabled={saving || !amount} className="btn-primary disabled:opacity-50">
          {saving ? <Loader2 size={14} className="animate-spin" /> : null}
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
}
