'use client';

import { useEffect, useRef, useState } from 'react';
import { formatCurrency } from '@/lib/utils';
import Spinner from '@/components/ui/Spinner';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Camera, Plus, Trash2, AlertCircle, Loader2, CheckCircle2, X } from 'lucide-react';

/* ---------- types ---------- */
interface MonthlyRow {
  month: string;
  order_count: number;
  total_ordered: number;
  total_paid: number;
  outstanding: number;
}
interface Totals {
  grand_total_ordered: number;
  grand_total_paid: number;
  grand_outstanding: number;
}
interface Expense {
  id: number;
  date: string;
  amount: number;
  description: string | null;
  category: string | null;
  reference_no: string | null;
  bank_from: string | null;
  bank_to: string | null;
  created_at: string;
}

const CATEGORIES = [
  'Supplier Payment', 'Ads Budget', 'Shipping Fee',
  'Utilities', 'Salary', 'Rent', 'Office Supplies', 'Others',
];

const EMPTY_FORM = { date: '', amount: '', description: '', category: 'Others', reference_no: '', bank_from: '', bank_to: '' };

function formatMonth(m: string) {
  const [y, mo] = m.split('-');
  return new Date(parseInt(y), parseInt(mo) - 1).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
}

/* ---------- component ---------- */
export default function ExpensesClient() {
  // PO summary state
  const [monthly, setMonthly]   = useState<MonthlyRow[]>([]);
  const [totals, setTotals]     = useState<Totals | null>(null);
  const [poLoading, setPoLoading] = useState(true);

  // Expenses state
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [expLoading, setExpLoading] = useState(true);
  const [form, setForm]         = useState(EMPTY_FORM);
  const [saving, setSaving]     = useState(false);
  const [showForm, setShowForm] = useState(false);

  // Scan state
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanSuccess, setScanSuccess] = useState(false);
  const [preview, setPreview]   = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/reports/monthly-expenses').then(r => r.json()).then(d => {
      setMonthly(d.monthly ?? []);
      setTotals(d.totals ?? null);
      setPoLoading(false);
    });
    loadExpenses();
  }, []);

  function loadExpenses() {
    setExpLoading(true);
    fetch('/api/expenses').then(r => r.json()).then(d => {
      setExpenses(Array.isArray(d) ? d : []);
      setExpLoading(false);
    });
  }

  const handleScan = async (file: File) => {
    setScanning(true);
    setScanError(null);
    setScanSuccess(false);
    setPreview(URL.createObjectURL(file));
    setShowForm(true);

    const fd = new FormData();
    fd.append('image', file);
    try {
      const res = await fetch('/api/expenses/scan', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Scan failed.');
      const e = data.expense;
      setForm({
        date:         e.date ?? '',
        amount:       e.amount != null ? String(e.amount) : '',
        description:  e.description ?? '',
        category:     CATEGORIES.includes(e.category) ? e.category : 'Others',
        reference_no: e.reference_no ?? '',
        bank_from:    e.bank_from ?? '',
        bank_to:      e.bank_to ?? '',
      });
      setScanSuccess(true);
    } catch (err: any) {
      setScanError(err.message || 'Could not scan image.');
    } finally {
      setScanning(false);
    }
  };

  const handleSave = async () => {
    if (!form.date || !form.amount) return;
    setSaving(true);
    try {
      await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...form, amount: parseFloat(form.amount) }),
      });
      setForm(EMPTY_FORM);
      setShowForm(false);
      setPreview(null);
      setScanSuccess(false);
      loadExpenses();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    await fetch('/api/expenses', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) });
    setExpenses(prev => prev.filter(e => e.id !== id));
  };

  const chartData = [...monthly].reverse().map(r => ({
    month: formatMonth(r.month).replace(' 2026', '').replace(' 2025', ''),
    Ordered: r.total_ordered,
    Paid: r.total_paid,
    Outstanding: r.outstanding,
  }));

  const expTotal = expenses.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Monthly Expenses</h1>
        <p className="text-sm text-gray-500 mt-1">Track supplier payments and outstanding balances</p>
      </div>

      {/* PO KPIs */}
      {!poLoading && totals && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="card text-center">
            <p className="text-xs text-gray-500 mb-1">Total Ordered (All Time)</p>
            <p className="text-2xl font-bold text-gray-900">{formatCurrency(totals.grand_total_ordered)}</p>
          </div>
          <div className="card text-center">
            <p className="text-xs text-gray-500 mb-1">Total Paid</p>
            <p className="text-2xl font-bold text-green-700">{formatCurrency(totals.grand_total_paid)}</p>
          </div>
          <div className="card text-center">
            <p className="text-xs text-gray-500 mb-1">Outstanding Balance</p>
            <p className="text-2xl font-bold text-red-600">{formatCurrency(totals.grand_outstanding)}</p>
          </div>
        </div>
      )}

      {/* Chart */}
      {chartData.length > 0 && (
        <div className="card">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Monthly Spending Overview (Purchase Orders)</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `₱${(v/1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Legend />
              <Bar dataKey="Ordered"     fill="#94a3b8" radius={[4,4,0,0]} maxBarSize={40} />
              <Bar dataKey="Paid"        fill="#22c55e" radius={[4,4,0,0]} maxBarSize={40} />
              <Bar dataKey="Outstanding" fill="#ef4444" radius={[4,4,0,0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── EXPENSE TRACKER ── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Expense Tracker</h2>
            <p className="text-xs text-gray-500">Upload a receipt or bank transfer screenshot to auto-encode</p>
          </div>
          <div className="flex gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleScan(f); e.target.value = ''; }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="btn-primary gap-2 text-sm"
              disabled={scanning}
            >
              {scanning ? <Loader2 size={15} className="animate-spin" /> : <Camera size={15} />}
              {scanning ? 'Scanning...' : 'Scan Receipt'}
            </button>
            <button
              onClick={() => { setShowForm(v => !v); setPreview(null); setScanSuccess(false); setScanError(null); setForm(EMPTY_FORM); }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50"
            >
              <Plus size={15} /> Manual
            </button>
          </div>
        </div>

        {scanError && (
          <div className="card border-red-200 bg-red-50 flex items-start gap-2 text-sm text-red-700">
            <AlertCircle size={16} className="shrink-0 mt-0.5" /> {scanError}
          </div>
        )}

        {showForm && (
          <div className="card space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                {scanSuccess && <CheckCircle2 size={16} className="text-green-500" />}
                {scanSuccess ? 'Receipt scanned — confirm details below' : 'New Expense'}
              </p>
              <button onClick={() => { setShowForm(false); setPreview(null); setScanSuccess(false); setForm(EMPTY_FORM); }}>
                <X size={16} className="text-gray-400 hover:text-gray-600" />
              </button>
            </div>

            {preview && (
              <img src={preview} alt="Receipt preview" className="w-48 h-auto rounded-lg border border-gray-200 object-contain" />
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Date *</label>
                <input type="date" className="form-input" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Amount (₱) *</label>
                <input type="number" className="form-input" placeholder="0.00" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
                <input type="text" className="form-input" placeholder="What was this for?" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
                <select className="form-input" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                  {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Reference No.</label>
                <input type="text" className="form-input" placeholder="Transaction/ref number" value={form.reference_no} onChange={e => setForm(f => ({ ...f, reference_no: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">From (Bank / Sender)</label>
                <input type="text" className="form-input" placeholder="e.g. GCash, BDO" value={form.bank_from} onChange={e => setForm(f => ({ ...f, bank_from: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">To (Bank / Recipient)</label>
                <input type="text" className="form-input" placeholder="e.g. Supplier BDO account" value={form.bank_to} onChange={e => setForm(f => ({ ...f, bank_to: e.target.value }))} />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => { setShowForm(false); setPreview(null); setForm(EMPTY_FORM); }} className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.date || !form.amount}
                className="btn-primary disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                {saving ? 'Saving...' : 'Save Expense'}
              </button>
            </div>
          </div>
        )}

        {/* Expense list */}
        <div className="card overflow-x-auto">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-800">Recorded Expenses</h3>
            {expenses.length > 0 && (
              <span className="text-sm font-bold text-gray-900">Total: {formatCurrency(expTotal)}</span>
            )}
          </div>

          {expLoading ? (
            <div className="flex justify-center py-8"><Spinner size={24} /></div>
          ) : expenses.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No expenses recorded yet. Upload a receipt to get started.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  {['Date', 'Description', 'Category', 'Reference No.', 'From → To', 'Amount', ''].map(h => (
                    <th key={h} className="table-header">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {expenses.map((e, i) => (
                  <tr key={e.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="table-cell text-gray-600 whitespace-nowrap">{e.date}</td>
                    <td className="table-cell text-gray-800">{e.description ?? '—'}</td>
                    <td className="table-cell">
                      <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">{e.category ?? 'Others'}</span>
                    </td>
                    <td className="table-cell text-gray-500 text-xs">{e.reference_no ?? '—'}</td>
                    <td className="table-cell text-xs text-gray-500">
                      {e.bank_from || e.bank_to ? `${e.bank_from ?? '?'} → ${e.bank_to ?? '?'}` : '—'}
                    </td>
                    <td className="table-cell font-semibold text-gray-900 text-right whitespace-nowrap">{formatCurrency(e.amount)}</td>
                    <td className="table-cell">
                      <button onClick={() => handleDelete(e.id)} className="text-gray-300 hover:text-red-500">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
