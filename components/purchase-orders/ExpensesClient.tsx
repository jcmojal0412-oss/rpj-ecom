'use client';

import { useEffect, useRef, useState } from 'react';
import { formatCurrency } from '@/lib/utils';
import Spinner from '@/components/ui/Spinner';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Camera, Plus, Trash2, AlertCircle, Loader2, CheckCircle2, X, ChevronDown } from 'lucide-react';
import { scanReceipt } from '@/lib/scan-receipt';

interface MonthlyRow {
  month: string; order_count: number; total_ordered: number; total_paid: number; outstanding: number;
}
interface Totals {
  grand_total_ordered: number; grand_total_paid: number; grand_outstanding: number;
}
interface Expense {
  id: number; date: string; amount: number; description: string | null;
  category: string | null; reference_no: string | null; bank_from: string | null; bank_to: string | null;
}

const CATEGORIES = [
  'Supplier Payment','Ads Budget','Shipping Fee',
  'Utilities','Salary','Rent','Office Supplies','Others',
];
const EMPTY_FORM = { date: '', amount: '', description: '', category: 'Others', reference_no: '', bank_from: '', bank_to: '' };

interface ScanItem {
  file: File;
  previewUrl: string;
  status: 'scanning' | 'done' | 'error';
  error?: string;
  date: string;
  amount: string;
  description: string;
  category: string;
  reference_no: string;
  bank_from: string;
  bank_to: string;
  saved: boolean;
}

function formatMonth(m: string) {
  const [y, mo] = m.split('-');
  return new Date(parseInt(y), parseInt(mo) - 1).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
}

export default function ExpensesClient() {
  const [monthly, setMonthly] = useState<MonthlyRow[]>([]);
  const [totals, setTotals]   = useState<Totals | null>(null);
  const [poLoading, setPoLoading] = useState(true);
  const [expenses, setExpenses]   = useState<Expense[]>([]);
  const [expLoading, setExpLoading] = useState(true);

  // scan items
  const [items, setItems] = useState<ScanItem[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // manual form
  const [showManual, setShowManual] = useState(false);
  const [form, setForm]   = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [savingIdx, setSavingIdx] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/reports/monthly-expenses').then(r => r.json()).then(d => {
      setMonthly(d.monthly ?? []); setTotals(d.totals ?? null); setPoLoading(false);
    });
    loadExpenses();
  }, []);

  function loadExpenses() {
    setExpLoading(true);
    fetch('/api/expenses').then(r => r.json()).then(d => {
      setExpenses(Array.isArray(d) ? d : []); setExpLoading(false);
    });
  }

  const updateItem = (i: number, patch: Partial<ScanItem>) =>
    setItems(prev => prev.map((it, idx) => idx === i ? { ...it, ...patch } : it));

  const handleFiles = async (files: FileList) => {
    const newItems: ScanItem[] = Array.from(files).map(file => ({
      file, previewUrl: URL.createObjectURL(file),
      status: 'scanning', date: new Date().toISOString().slice(0, 10),
      amount: '', description: '', category: 'Others', reference_no: '', bank_from: '', bank_to: '',
      saved: false,
    }));
    const offset = items.length;
    setItems(prev => [...prev, ...newItems]);

    await Promise.all(newItems.map(async (item, j) => {
      const i = offset + j;
      try {
        const e = await scanReceipt(item.file);
        updateItem(i, {
          status: 'done',
          date:         e.date || new Date().toISOString().slice(0, 10),
          amount:       e.amount != null ? String(e.amount) : '',
          description:  e.description || '',
          category:     CATEGORIES.includes(e.category) ? e.category : 'Others',
          reference_no: e.reference_no || '',
          bank_from:    e.bank_from || '',
          bank_to:      e.bank_to || '',
        });
      } catch (err: any) {
        updateItem(i, { status: 'error', error: err.message || 'Scan failed' });
      }
    }));
  };

  const saveItem = async (i: number) => {
    const item = items[i];
    if (!item.date || !item.amount) return;
    setSavingIdx(i);
    try {
      await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...item, amount: parseFloat(item.amount) }),
      });
      updateItem(i, { saved: true });
      loadExpenses();
    } finally {
      setSavingIdx(null);
    }
  };

  const saveAll = async () => {
    for (let i = 0; i < items.length; i++) {
      if (!items[i].saved && items[i].status === 'done' && items[i].amount) {
        await saveItem(i);
      }
    }
  };

  const handleManualSave = async () => {
    if (!form.date || !form.amount) return;
    setSaving(true);
    try {
      await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...form, amount: parseFloat(form.amount) }),
      });
      setForm(EMPTY_FORM); setShowManual(false); loadExpenses();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    await fetch('/api/expenses', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) });
    setExpenses(prev => prev.filter(e => e.id !== id));
  };

  const chartData = [...monthly].reverse().map(r => ({
    month: formatMonth(r.month).replace(' 2026','').replace(' 2025',''),
    Ordered: r.total_ordered, Paid: r.total_paid, Outstanding: r.outstanding,
  }));

  const expTotal = expenses.reduce((s, e) => s + e.amount, 0);
  const readyCount = items.filter(it => it.status === 'done' && it.amount && !it.saved).length;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Monthly Expenses</h1>
        <p className="text-sm text-gray-500 mt-1">Track supplier payments and outstanding balances</p>
      </div>

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
            <p className="text-xs text-gray-500">Upload receipts or add manually</p>
          </div>
          <div className="flex gap-2">
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
              onChange={e => { if (e.target.files?.length) handleFiles(e.target.files); e.target.value = ''; }} />
            <button onClick={() => fileRef.current?.click()}
              className="flex items-center gap-2 px-3 py-2 rounded-xl border border-orange-300 text-orange-600 bg-orange-50 hover:bg-orange-100 text-sm font-semibold transition-colors">
              <Camera size={15} /> Scan Receipts
            </button>
            <button onClick={() => setShowManual(v => !v)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50">
              <Plus size={15} /> Manual
            </button>
          </div>
        </div>

        {/* Scanned items */}
        {items.length > 0 && (
          <div className="space-y-3">
            {items.map((item, i) => (
              <div key={i} className={`border rounded-xl p-3 space-y-3 ${item.saved ? 'border-green-200 bg-green-50/30' : 'border-gray-200 bg-white'}`}>
                <div className="flex items-start gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.previewUrl} alt="" className="w-16 h-16 object-cover rounded-lg border border-gray-100 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-600 truncate">{item.file.name}</p>
                    {item.status === 'scanning' && (
                      <div className="flex items-center gap-1.5 text-xs text-orange-500 mt-1">
                        <Loader2 size={12} className="animate-spin" /> AI is reading receipt...
                      </div>
                    )}
                    {item.status === 'error' && (
                      <div className="flex items-center gap-1.5 text-xs text-red-500 mt-1">
                        <AlertCircle size={12} /> {item.error}
                      </div>
                    )}
                    {item.status === 'done' && !item.saved && (
                      <div className="text-xs text-green-600 mt-1 flex items-center gap-1">
                        <CheckCircle2 size={12} /> Auto-filled — verify below
                      </div>
                    )}
                    {item.saved && (
                      <div className="text-xs text-green-700 mt-1 flex items-center gap-1">
                        <CheckCircle2 size={12} /> Saved — {formatCurrency(parseFloat(item.amount))}
                      </div>
                    )}
                  </div>
                  <button onClick={() => setItems(prev => prev.filter((_, idx) => idx !== i))} className="text-gray-300 hover:text-red-400 shrink-0">
                    <X size={14} />
                  </button>
                </div>

                {(item.status === 'done' || item.status === 'error') && !item.saved && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] font-medium text-gray-500 mb-0.5">Date</label>
                      <input type="date" className="form-input text-sm py-1.5" value={item.date}
                        onChange={e => updateItem(i, { date: e.target.value })} />
                    </div>
                    <div>
                      <label className="block text-[10px] font-medium text-gray-500 mb-0.5">Amount (₱)</label>
                      <input type="number" className="form-input text-sm py-1.5" placeholder="0.00" value={item.amount}
                        onChange={e => updateItem(i, { amount: e.target.value })} />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-[10px] font-medium text-gray-500 mb-0.5">Description</label>
                      <input type="text" className="form-input text-sm py-1.5" placeholder="What was this for?" value={item.description}
                        onChange={e => updateItem(i, { description: e.target.value })} />
                    </div>
                    <div>
                      <label className="block text-[10px] font-medium text-gray-500 mb-0.5">Category</label>
                      <div className="relative">
                        <select className="form-input text-sm py-1.5 pr-7 appearance-none" value={item.category}
                          onChange={e => updateItem(i, { category: e.target.value })}>
                          {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                        </select>
                        <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] font-medium text-gray-500 mb-0.5">Reference No.</label>
                      <input type="text" className="form-input text-sm py-1.5" placeholder="Ref / TXN number" value={item.reference_no}
                        onChange={e => updateItem(i, { reference_no: e.target.value })} />
                    </div>
                    <div>
                      <label className="block text-[10px] font-medium text-gray-500 mb-0.5">From (Bank/Sender)</label>
                      <input type="text" className="form-input text-sm py-1.5" placeholder="GCash, BDO..." value={item.bank_from}
                        onChange={e => updateItem(i, { bank_from: e.target.value })} />
                    </div>
                    <div>
                      <label className="block text-[10px] font-medium text-gray-500 mb-0.5">To (Recipient)</label>
                      <input type="text" className="form-input text-sm py-1.5" placeholder="Supplier, payee..." value={item.bank_to}
                        onChange={e => updateItem(i, { bank_to: e.target.value })} />
                    </div>
                    <div className="col-span-2 flex justify-end">
                      <button onClick={() => saveItem(i)} disabled={savingIdx === i || !item.amount || !item.date}
                        className="btn-primary text-xs py-1.5 disabled:opacity-50">
                        {savingIdx === i ? <Loader2 size={12} className="animate-spin" /> : null}
                        {savingIdx === i ? 'Saving...' : 'Save this expense'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {readyCount > 1 && (
              <button onClick={saveAll} className="btn-primary w-full justify-center">
                Save All {readyCount} Expenses
              </button>
            )}
          </div>
        )}

        {/* Manual form */}
        {showManual && (
          <div className="card space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-800">Manual Entry</p>
              <button onClick={() => { setShowManual(false); setForm(EMPTY_FORM); }}>
                <X size={16} className="text-gray-400 hover:text-gray-600" />
              </button>
            </div>
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
                <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
                <input type="text" className="form-input" placeholder="GCash, BDO..." value={form.bank_from} onChange={e => setForm(f => ({ ...f, bank_from: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
                <input type="text" className="form-input" placeholder="Supplier, payee..." value={form.bank_to} onChange={e => setForm(f => ({ ...f, bank_to: e.target.value }))} />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => { setShowManual(false); setForm(EMPTY_FORM); }} className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={handleManualSave} disabled={saving || !form.date || !form.amount} className="btn-primary disabled:opacity-60">
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
            {expenses.length > 0 && <span className="text-sm font-bold text-gray-900">Total: {formatCurrency(expTotal)}</span>}
          </div>
          {expLoading ? (
            <div className="flex justify-center py-8"><Spinner size={24} /></div>
          ) : expenses.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No expenses recorded yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  {['Date','Description','Category','Reference No.','From → To','Amount',''].map(h => (
                    <th key={h} className="table-header">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {expenses.map((e, i) => (
                  <tr key={e.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="table-cell text-gray-600 whitespace-nowrap">{e.date}</td>
                    <td className="table-cell text-gray-800">{e.description ?? '—'}</td>
                    <td className="table-cell"><span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">{e.category ?? 'Others'}</span></td>
                    <td className="table-cell text-gray-500 text-xs">{e.reference_no ?? '—'}</td>
                    <td className="table-cell text-xs text-gray-500">
                      {e.bank_from || e.bank_to ? `${e.bank_from ?? '?'} → ${e.bank_to ?? '?'}` : '—'}
                    </td>
                    <td className="table-cell font-semibold text-gray-900 text-right whitespace-nowrap">{formatCurrency(e.amount)}</td>
                    <td className="table-cell">
                      <button onClick={() => handleDelete(e.id)} className="text-gray-300 hover:text-red-500"><Trash2 size={14} /></button>
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
