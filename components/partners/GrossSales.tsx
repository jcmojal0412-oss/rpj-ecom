'use client';

import { Fragment, useEffect, useState, useCallback } from 'react';
import { Plus, Trash2, TrendingUp, ChevronDown, ChevronUp } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import Modal from '@/components/ui/Modal';
import Spinner from '@/components/ui/Spinner';

type DatePeriod = 'today' | 'yesterday' | '7days' | 'this_month' | 'last_month' | 'month' | 'lifetime';

const DATE_FILTERS: { key: DatePeriod; label: string }[] = [
  { key: 'today',      label: 'Today'       },
  { key: 'yesterday',  label: 'Yesterday'   },
  { key: '7days',      label: 'Last 7 Days' },
  { key: 'this_month', label: 'This Month'  },
  { key: 'last_month', label: 'Last Month'  },
  { key: 'month',      label: 'Pick Month'  },
  { key: 'lifetime',   label: 'Lifetime'    },
];

interface SalesRow {
  id: number; name: string; company_name: string | null;
  subscription: string | null; gross_sales: number; entry_count: number;
  active: number;
}
interface SaleEntry {
  id: number; partner_id: number; amount: number;
  period_label: string | null; sale_date: string | null; notes: string | null;
}

export default function GrossSales() {
  const [period, setPeriod]           = useState<DatePeriod>('this_month');
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  const [rows, setRows]           = useState<SalesRow[]>([]);
  const [total, setTotal]         = useState(0);
  const [loading, setLoading]     = useState(true);
  const [addingFor, setAddingFor] = useState<SalesRow | null>(null);
  const [expanded, setExpanded]   = useState<number | null>(null);
  const [entries, setEntries]     = useState<SaleEntry[]>([]);

  const fetchSales = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ period });
    if (period === 'month') params.set('month', selectedMonth);
    const res = await fetch(`/api/partner-sales?${params}`).then(r => r.json());
    setRows(res.rows ?? []);
    setTotal(res.total ?? 0);
    setLoading(false);
  }, [period, selectedMonth]);

  useEffect(() => { fetchSales(); }, [fetchSales]);

  const loadEntries = async (partnerId: number) => {
    const data = await fetch(`/api/partner-sales/${partnerId}`).then(r => r.json());
    setEntries(Array.isArray(data) ? data : []);
    setExpanded(partnerId);
  };

  const deleteEntry = async (entryId: number, partnerId: number) => {
    await fetch(`/api/partner-sales/${entryId}`, { method: 'DELETE' });
    loadEntries(partnerId);
    fetchSales();
  };

  const subColors: Record<string, string> = {
    'ELITE WV':           'bg-purple-100 text-purple-700',
    'STARTER WV':         'bg-blue-100 text-blue-700',
    'OLD PARTNER STARTER':'bg-gray-100 text-gray-600',
  };

  return (
    <div className="space-y-4">
      {/* Header + Period Filter */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="text-orange-500" size={20} />
          <h2 className="text-base font-semibold text-gray-900">Gross Sales per Partner</h2>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {DATE_FILTERS.map(({ key, label }) => (
            <button key={key} onClick={() => setPeriod(key)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                period === key ? 'bg-orange-500 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}>{label}</button>
          ))}
          {period === 'month' && (
            <input
              type="month"
              value={selectedMonth}
              onChange={e => setSelectedMonth(e.target.value)}
              className="form-input text-xs py-1.5 w-40"
            />
          )}
        </div>
      </div>

      {/* Total banner */}
      <div className="bg-gradient-to-r from-orange-50 to-amber-50 border border-orange-200 rounded-xl px-5 py-3 flex items-center justify-between">
        <p className="text-sm font-medium text-orange-700">
          Total Gross Sales — {DATE_FILTERS.find(f => f.key === period)?.label}
        </p>
        <p className="text-2xl font-black text-orange-600">{formatCurrency(total)}</p>
      </div>

      {/* Per partner table */}
      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-100">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="table-header w-10">#</th>
                <th className="table-header">Partner</th>
                <th className="table-header">Subscription</th>
                <th className="table-header text-right">Gross Sales</th>
                <th className="table-header text-center">Entries</th>
                <th className="table-header text-center">Active</th>
                <th className="table-header text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.filter(r => r.active !== 0).length > 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-2 bg-green-50 text-xs font-bold text-green-700 uppercase tracking-wider border-y border-green-100">
                    🟢 Active Partners — sorted highest to lowest
                  </td>
                </tr>
              )}
              {(() => {
                const activeRows   = rows.filter(r => r.active !== 0);
                const inactiveRows = rows.filter(r => r.active === 0);
                const sorted = [...activeRows, ...inactiveRows];
                let activeRank = 0;
                return sorted.map((row, i) => {
                const isActive = row.active !== 0;
                if (isActive) activeRank++;
                const showDivider = !isActive && i > 0 && sorted[i-1].active !== 0;
                const rankEmoji = isActive
                  ? (activeRank === 1 ? '🥇' : activeRank === 2 ? '🥈' : activeRank === 3 ? '🥉' : `${activeRank}`)
                  : '—';
                return (
                <Fragment key={row.id}>
                  {showDivider && (
                    <tr key={`divider-${row.id}`}>
                      <td colSpan={7} className="px-4 py-2 bg-gray-100 text-xs font-bold text-gray-400 uppercase tracking-wider border-y border-gray-200">
                        ⚫ Inactive Partners
                      </td>
                    </tr>
                  )}
                  <tr className={`${!isActive ? 'opacity-50' : ''} ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                    <td className="table-cell text-center font-bold text-gray-500">
                      <span className="text-base">{rankEmoji}</span>
                    </td>
                    <td className="table-cell">
                      <p className={`font-semibold ${isActive ? 'text-gray-900' : 'text-gray-400 line-through'}`}>{row.name}</p>
                      {row.company_name && <p className="text-xs text-gray-400">{row.company_name}</p>}
                    </td>
                    <td className="table-cell">
                      {row.subscription ? (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${subColors[row.subscription] ?? 'bg-gray-100 text-gray-600'}`}>
                          {row.subscription}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="table-cell text-right">
                      <span className={`font-bold ${row.gross_sales > 0 ? 'text-green-700' : 'text-gray-400'}`}>
                        {row.gross_sales > 0 ? formatCurrency(row.gross_sales) : '—'}
                      </span>
                    </td>
                    <td className="table-cell text-center text-gray-500">{row.entry_count}</td>
                    <td className="table-cell text-center">
                      <button
                        onClick={async () => {
                          await fetch(`/api/partners/${row.id}/toggle`, { method: 'POST' });
                          fetchSales();
                        }}
                        className={`relative inline-flex w-10 h-5 rounded-full transition-colors duration-200 focus:outline-none ${
                          isActive ? 'bg-green-500' : 'bg-gray-300'
                        }`}
                      >
                        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${
                          isActive ? 'translate-x-5' : 'translate-x-0'
                        }`} />
                      </button>
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => setAddingFor(row)}
                          className="flex items-center gap-1 px-2 py-1 bg-orange-500 text-white text-xs rounded-lg hover:bg-orange-600 transition-colors"
                        >
                          <Plus size={11} /> Add
                        </button>
                        {row.entry_count > 0 && (
                          <button
                            onClick={() => expanded === row.id ? setExpanded(null) : loadEntries(row.id)}
                            className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
                          >
                            {expanded === row.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>

                  {/* Expanded entries */}
                  {expanded === row.id && (
                    <tr>
                      <td colSpan={7} className="bg-blue-50/40 px-6 py-3">
                        <p className="text-xs font-semibold text-gray-500 mb-2">Sales History</p>
                        <div className="space-y-1.5">
                          {entries.map(e => (
                            <div key={e.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-gray-100">
                              <div className="flex items-center gap-3 text-xs">
                                <span className="font-bold text-green-700">{formatCurrency(e.amount)}</span>
                                {e.period_label && <span className="text-gray-600">{e.period_label}</span>}
                                {e.sale_date && <span className="text-gray-400">{new Date(e.sale_date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}</span>}
                                {e.notes && <span className="text-gray-400 italic">{e.notes}</span>}
                              </div>
                              <button onClick={() => deleteEntry(e.id, row.id)}
                                className="p-1 hover:bg-red-50 text-gray-300 hover:text-red-500 rounded transition-colors">
                                <Trash2 size={12} />
                              </button>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
                );
              });
              })()}
              {rows.length === 0 && (
                <tr><td colSpan={7} className="text-center py-8 text-gray-400 text-sm">No onboarded partners yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Sales Modal */}
      {addingFor && (
        <Modal open={!!addingFor} onClose={() => setAddingFor(null)} title={`Add Sales — ${addingFor.name}`} size="sm">
          <AddSalesForm
            partner={addingFor}
            onSuccess={() => { setAddingFor(null); fetchSales(); }}
            onCancel={() => setAddingFor(null)}
          />
        </Modal>
      )}
    </div>
  );
}

function AddSalesForm({ partner, onSuccess, onCancel }: {
  partner: SalesRow; onSuccess: () => void; onCancel: () => void;
}) {
  const [amount,  setAmount]  = useState('');
  const [label,   setLabel]   = useState('');
  const [date,    setDate]    = useState(new Date().toISOString().slice(0, 10));
  const [notes,   setNotes]   = useState('');
  const [saving,  setSaving]  = useState(false);

  // Auto-suggest period label
  useEffect(() => {
    const now = new Date();
    const monthLabel = now.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
    setLabel(monthLabel);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount) return;
    setSaving(true);
    await fetch('/api/partner-sales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        partner_id: partner.id,
        amount: parseFloat(amount),
        period_label: label || null,
        sale_date: date || null,
        notes: notes || null,
      }),
    });
    setSaving(false);
    onSuccess();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="bg-gray-50 rounded-xl px-4 py-3 text-sm">
        <p className="font-semibold text-gray-900">{partner.name}</p>
        {partner.company_name && <p className="text-gray-500 text-xs">{partner.company_name}</p>}
      </div>
      <div>
        <label className="form-label">Gross Sales Amount (₱) *</label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-medium">₱</span>
          <input type="number" step="0.01" className="form-input pl-7 text-lg font-bold"
            placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} required autoFocus />
        </div>
      </div>
      <div>
        <label className="form-label">Period Label</label>
        <input className="form-input" placeholder="e.g. June 2026, Week 1 July..."
          value={label} onChange={e => setLabel(e.target.value)} />
      </div>
      <div>
        <label className="form-label">Date</label>
        <input type="date" className="form-input" value={date} onChange={e => setDate(e.target.value)} />
      </div>
      <div>
        <label className="form-label">Notes (optional)</label>
        <input className="form-input" placeholder="Additional info..."
          value={notes} onChange={e => setNotes(e.target.value)} />
      </div>
      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onCancel} className="btn-secondary">Cancel</button>
        <button type="submit" disabled={saving || !amount} className="btn-primary disabled:opacity-50">
          {saving ? 'Saving...' : 'Save Sales'}
        </button>
      </div>
    </form>
  );
}
