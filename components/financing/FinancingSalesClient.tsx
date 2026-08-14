'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Camera, Landmark, Loader2, Pencil, Trash2,
  WalletCards, CreditCard, BadgeDollarSign, HandCoins, MonitorSmartphone,
  ArrowUp, ArrowDown,
} from 'lucide-react';
import { formatCurrency, formatDate, todayISO } from '@/lib/utils';
import { resolvePeriod, pctChange, PERIOD_OPTIONS, type PeriodKey } from '@/lib/marketing-analytics';
import { Toast, useToast } from '@/components/ui/Toast';
import Modal from '@/components/ui/Modal';
import FinancingScanModal from './FinancingScanModal';

const PROVIDERS = ['SKYRO', 'BILLEASE', 'SALMON', 'HOME CREDIT', 'POS TERMINAL'];
const FILTERS = ['ALL', ...PROVIDERS];

// One consistent icon per provider (Lucide) — deliberately distinct from
// each other and from the shared "Landmark" used for the Total KPI, so no
// two cards read as visually identical.
const PROVIDER_ICON: Record<string, React.ElementType> = {
  SKYRO: WalletCards,
  BILLEASE: CreditCard,
  SALMON: BadgeDollarSign,
  'HOME CREDIT': HandCoins,
  'POS TERMINAL': MonitorSmartphone,
};

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
  SKYRO: 'bg-sky-100 text-sky-700',
  BILLEASE: 'bg-blue-700 text-white',
  SALMON: 'bg-pink-100 text-pink-700',
  'HOME CREDIT': 'bg-red-100 text-red-700',
  'POS TERMINAL': 'bg-yellow-100 text-yellow-800',
};

function pctOf(amount: number, total: number): number {
  return total <= 0 ? 0 : (amount / total) * 100;
}

export default function FinancingSalesClient() {
  const { toast, showToast, clearToast } = useToast();
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('ALL');
  const [period, setPeriod] = useState<PeriodKey>('this_month');
  const [customFrom, setCustomFrom] = useState(todayISO());
  const [customTo, setCustomTo] = useState(todayISO());
  const [appliedCustom, setAppliedCustom] = useState({ from: todayISO(), to: todayISO() });
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

  // Reuses the same date-range resolver as Marketing Analytics (9 presets +
  // custom, with a matching previous-period range) rather than
  // re-implementing period math a second time — this endpoint's data is
  // filtered client-side since financing_sales.sale_date is nullable and
  // there's no server-side date-range query for it yet.
  const range = useMemo(
    () => resolvePeriod(period, todayISO(), appliedCustom.from, appliedCustom.to),
    [period, appliedCustom]
  );

  const inRangeOf = (from: string, to: string) =>
    sales.filter(s => s.sale_date && s.sale_date >= from && s.sale_date <= to);

  const inRange = useMemo(() => inRangeOf(range.from, range.to), [sales, range]);
  const prevInRange = useMemo(() => inRangeOf(range.prevFrom, range.prevTo), [sales, range]);

  const totals = PROVIDERS.reduce<Record<string, number>>((acc, p) => {
    acc[p] = inRange.filter(s => s.provider === p).reduce((sum, s) => sum + s.amount, 0);
    return acc;
  }, {});
  const grandTotal = inRange.reduce((sum, s) => sum + s.amount, 0);
  const prevGrandTotal = prevInRange.reduce((sum, s) => sum + s.amount, 0);
  const totalChange = pctChange(grandTotal, prevGrandTotal);

  const visible = filter === 'ALL' ? inRange : inRange.filter(s => s.provider === filter);

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
    <div className="min-h-screen bg-[#F6F8FC] p-6 space-y-6">
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-[28px] font-bold text-[#16233B]">Financing Sales</h1>
          <p className="text-sm text-[#66758A] mt-1">Monitor financing transactions and sales performance across all providers.</p>
        </div>

        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={period}
              onChange={e => setPeriod(e.target.value as PeriodKey)}
              className="text-sm border border-[#E5EAF0] rounded-lg px-3 py-2.5 bg-white text-[#16233B] focus:outline-none focus:ring-1 focus:ring-[#B68B3C]"
            >
              {PERIOD_OPTIONS.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
            </select>
            <button
              onClick={() => setShowScan(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#233653] hover:bg-[#1b2941] text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Camera size={16} className="text-[#B68B3C]" /> Upload Screenshot
            </button>
          </div>
          {period === 'custom' && (
            <div className="flex items-center flex-wrap gap-2">
              <input type="date" value={customFrom} max={customTo} onChange={e => setCustomFrom(e.target.value)} className="text-xs border border-[#E5EAF0] rounded-md px-2 py-1.5" />
              <span className="text-[#B7C0CC] text-xs">to</span>
              <input type="date" value={customTo} min={customFrom} max={todayISO()} onChange={e => setCustomTo(e.target.value)} className="text-xs border border-[#E5EAF0] rounded-md px-2 py-1.5" />
              <button
                onClick={() => setAppliedCustom({ from: customFrom, to: customTo })}
                className="text-xs font-semibold text-white bg-[#233653] hover:bg-[#1b2941] rounded-md px-3 py-1.5"
              >
                Apply
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Primary KPI — Total Financing Sales */}
      <div className="bg-white border border-[#E5EAF0] rounded-xl p-6 flex items-center gap-4">
        <div className="p-3 rounded-xl bg-[#FBF3E2] shrink-0">
          <Landmark className="text-[#B68B3C]" size={22} />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#66758A]">Total Financing Sales</p>
          <p className="text-3xl font-bold text-[#16233B] mt-1 whitespace-nowrap">{formatCurrency(grandTotal)}</p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-xs text-[#66758A]">Across all financing channels</span>
            {totalChange != null && (
              <span className={`text-xs font-semibold flex items-center gap-0.5 ${totalChange >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                {totalChange >= 0 ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
                {Math.abs(totalChange).toFixed(1)}% vs previous period
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Provider KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {PROVIDERS.map(p => {
          const Icon = PROVIDER_ICON[p];
          const amount = totals[p] ?? 0;
          const pct = pctOf(amount, grandTotal);
          return (
            <div key={p} className="bg-white border border-[#E5EAF0] rounded-xl p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 rounded-lg bg-[#F0F3F8] shrink-0">
                  <Icon size={18} className="text-[#66758A]" />
                </div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[#66758A] truncate">{p}</p>
              </div>
              <p className="text-2xl font-bold text-[#16233B] whitespace-nowrap">{formatCurrency(amount)}</p>
              <p className="text-xs text-[#66758A] mt-1">{pct.toFixed(1)}% of financing sales</p>
            </div>
          );
        })}
      </div>

      {/* Financing Mix — subtle horizontal breakdown, navy/gray only */}
      <div className="bg-white border border-[#E5EAF0] rounded-xl p-6">
        <p className="text-sm font-semibold text-[#16233B] mb-4">Financing Mix</p>
        <div className="space-y-3">
          {PROVIDERS.map(p => {
            const amount = totals[p] ?? 0;
            const pct = pctOf(amount, grandTotal);
            return (
              <div key={p}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-medium text-[#16233B]">{p}</span>
                  <span className="text-[#66758A] font-semibold">{pct.toFixed(1)}%</span>
                </div>
                <div className="h-2 bg-[#F0F3F8] rounded-full overflow-hidden">
                  <div className="h-full bg-[#233653] rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Provider filter tabs (scopes the table below only) */}
      <div className="flex gap-1.5 flex-wrap">
        {FILTERS.map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              filter === f ? 'bg-[#233653] text-white' : 'bg-[#F0F3F8] text-[#66758A] hover:bg-[#E5EAF0]'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white border border-[#E5EAF0] rounded-xl p-0 overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-300" size={24} /></div>
        ) : visible.length === 0 ? (
          <p className="text-sm text-[#94A2B4] text-center py-12">No financing sales in this period. Upload a screenshot to get started.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E5EAF0] text-left text-xs text-[#66758A]">
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Provider</th>
                  <th className="px-4 py-3 font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">Reference</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0F3F8]">
                {visible.map(s => (
                  <tr key={s.id} className="hover:bg-[#F6F8FC]">
                    <td className="px-4 py-3 text-[#16233B]">{s.sale_date ? formatDate(s.sale_date) : '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex text-[11px] font-semibold px-2 py-0.5 rounded-full ${PROVIDER_BADGE[s.provider] ?? 'bg-gray-100 text-gray-700'}`}>
                        {s.provider}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-semibold text-[#16233B] whitespace-nowrap">{formatCurrency(s.amount)}</td>
                    <td className="px-4 py-3 text-[#66758A]">{s.customer_name || '—'}</td>
                    <td className="px-4 py-3 text-[#94A2B4] text-xs">{s.reference_no || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setEditing(s)} className="p-1.5 rounded-lg hover:bg-[#F0F3F8] text-[#94A2B4] hover:text-[#16233B]">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => setDeleting(s)} className="p-1.5 rounded-lg hover:bg-red-50 text-[#94A2B4] hover:text-red-500">
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
