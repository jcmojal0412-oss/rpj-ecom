'use client';

import { useState, useEffect, useCallback } from 'react';
import { Eye, Pencil, Trash2, Download, FileSpreadsheet, Search } from 'lucide-react';
import { formatCurrency, formatDate, todayISO } from '@/lib/utils';
import Spinner from '@/components/ui/Spinner';
import { Toast, useToast } from '@/components/ui/Toast';
import { EXPENSE_CATEGORIES, EXPENSE_STATUSES, type Business, type Expense } from './constants';
import { DATE_PRESETS, resolvePresetRange, type DatePreset } from './dateRanges';
import ExpenseDetailsModal from './ExpenseDetailsModal';
import DeleteExpenseModal from './DeleteExpenseModal';

export default function TransactionsTab() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);

  const [preset, setPreset] = useState<DatePreset | null>(null);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [businessId, setBusinessId] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const [viewing, setViewing] = useState<Expense | null>(null);
  const [editingRow, setEditingRow] = useState<Expense | null>(null);
  const [deleting, setDeleting] = useState<Expense | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const { toast, showToast, clearToast } = useToast();

  const range = preset ? resolvePresetRange(preset, customFrom, customTo) : null;

  const fetchExpenses = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (range) { params.set('from', range.from); params.set('to', range.to); }
    if (businessId) params.set('business_id', businessId);
    if (category) params.set('category', category);
    if (status) params.set('status', status);
    if (search) params.set('search', search);
    const data = await fetch(`/api/expenses?${params.toString()}`).then(r => r.json());
    setExpenses(data.rows ?? []);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, customFrom, customTo, businessId, category, status, search]);

  useEffect(() => { fetchExpenses(); }, [fetchExpenses]);
  useEffect(() => {
    fetch('/api/businesses').then(r => r.json()).then(d => setBusinesses(d.rows ?? []));
  }, []);

  const runSearch = (e: React.FormEvent) => { e.preventDefault(); setSearch(searchInput.trim()); };

  const exportCSV = () => {
    const headers = ['Date', 'Business', 'Category', 'Paid To', 'Payment Method', 'Reference', 'Amount', 'Notes', 'Status'];
    const csvRows = expenses.map(e => [
      e.date, e.business_name || '', e.category, e.paid_to || '', e.payment_method || '',
      e.reference_no || '', e.amount, (e.description || '').replace(/[\r\n,]/g, ' '), e.status,
    ]);
    const csv = [headers, ...csvRows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `expenses-export-${todayISO()}.csv`;
    a.click();
  };

  const exportExcel = () => {
    const params = new URLSearchParams();
    if (range) { params.set('from', range.from); params.set('to', range.to); }
    if (businessId) params.set('business_id', businessId);
    if (category) params.set('category', category);
    if (status) params.set('status', status);
    if (search) params.set('search', search);
    window.location.href = `/api/expenses/export?${params.toString()}`;
  };

  const totalAmount = expenses.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="space-y-4">
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex items-center bg-gray-100 rounded-lg p-1 gap-0.5 w-fit flex-wrap">
          <button
            onClick={() => setPreset(null)}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${!preset ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            All Dates
          </button>
          {DATE_PRESETS.map(p => (
            <button key={p} onClick={() => setPreset(p)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all whitespace-nowrap ${preset === p ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {p}
            </button>
          ))}
        </div>

        {preset === 'Custom' && (
          <div className="flex items-center gap-3 flex-wrap">
            <input type="date" className="form-input py-1.5 text-sm w-auto" value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
            <span className="text-gray-400 text-sm">—</span>
            <input type="date" className="form-input py-1.5 text-sm w-auto" value={customTo} onChange={e => setCustomTo(e.target.value)} />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <select className="form-input py-1.5 text-sm w-auto" value={businessId} onChange={e => setBusinessId(e.target.value)}>
            <option value="">All Businesses</option>
            {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select className="form-input py-1.5 text-sm w-auto" value={category} onChange={e => setCategory(e.target.value)}>
            <option value="">All Categories</option>
            {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="form-input py-1.5 text-sm w-auto" value={status} onChange={e => setStatus(e.target.value)}>
            <option value="">All Status</option>
            {EXPENSE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <form onSubmit={runSearch} className="flex items-center gap-1.5 ml-auto">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-300" />
              <input className="form-input py-1.5 text-sm pl-8 w-48" placeholder="Search supplier, ref, notes"
                value={searchInput} onChange={e => setSearchInput(e.target.value)} />
            </div>
          </form>
          <button onClick={exportCSV} className="btn-secondary text-xs py-1.5"><Download size={13} /> CSV</button>
          <button onClick={exportExcel} className="btn-secondary text-xs py-1.5"><FileSpreadsheet size={13} /> Excel</button>
        </div>
      </div>

      <div className="card">
        {loading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : expenses.length === 0 ? (
          <p className="text-center text-gray-400 text-sm py-12">No expenses match these filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  {['Date', 'Business', 'Category', 'Paid To', 'Payment', 'Reference', 'Amount', 'Status', 'Receipt', 'Actions'].map(h => (
                    <th key={h} className="table-header">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {expenses.map((e, i) => (
                  <tr key={e.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="table-cell text-gray-500 whitespace-nowrap">{formatDate(e.date)}</td>
                    <td className="table-cell">{e.business_name || '—'}</td>
                    <td className="table-cell">{e.category}</td>
                    <td className="table-cell font-medium">{e.paid_to || '—'}</td>
                    <td className="table-cell text-gray-600">{e.payment_method || '—'}</td>
                    <td className="table-cell text-gray-500">{e.reference_no || '—'}</td>
                    <td className="table-cell font-semibold whitespace-nowrap">{formatCurrency(e.amount)}</td>
                    <td className="table-cell">
                      <span className={e.status === 'Verified' ? 'badge-green' : 'badge-amber'}>{e.status}</span>
                    </td>
                    <td className="table-cell">
                      {e.receipt_path ? (
                        <button onClick={() => setLightbox(e.receipt_path)} className="text-orange-600 hover:text-orange-800 text-xs font-semibold">View</button>
                      ) : '—'}
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center gap-1">
                        <button onClick={() => setViewing(e)} className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-600" title="View"><Eye size={14} /></button>
                        <button onClick={() => setEditingRow(e)} className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-600" title="Edit"><Pencil size={14} /></button>
                        <button onClick={() => setDeleting(e)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-500" title="Delete"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100 text-xs text-gray-500">
              <span>{expenses.length} transaction{expenses.length === 1 ? '' : 's'}</span>
              <span className="font-semibold text-gray-800">Total: {formatCurrency(totalAmount)}</span>
            </div>
          </div>
        )}
      </div>

      {viewing && (
        <ExpenseDetailsModal expense={viewing} businesses={businesses}
          onClose={() => setViewing(null)}
          onChanged={() => { setViewing(null); fetchExpenses(); }} />
      )}
      {editingRow && (
        <ExpenseDetailsModal expense={editingRow} businesses={businesses} initialEditing
          onClose={() => setEditingRow(null)}
          onChanged={() => { setEditingRow(null); fetchExpenses(); }} />
      )}
      {deleting && (
        <DeleteExpenseModal expense={deleting}
          onCancel={() => setDeleting(null)}
          onDeleted={() => { setDeleting(null); showToast('Expense deleted'); fetchExpenses(); }} />
      )}
      {lightbox && (
        <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-6" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="Receipt" className="max-h-[90vh] max-w-full rounded-lg" />
        </div>
      )}
    </div>
  );
}
