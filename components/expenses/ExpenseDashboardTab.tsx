'use client';

import { useState, useEffect, useMemo } from 'react';
import { Wallet, Store, ShoppingBag } from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend,
  PieChart, Pie, Cell,
} from 'recharts';
import { formatCurrency, formatDate } from '@/lib/utils';
import Spinner from '@/components/ui/Spinner';
import { EXPENSE_CATEGORIES, CATEGORY_ICON, CATEGORY_COLOR, CATEGORY_HEX, type Business, type Expense } from './constants';
import { DATE_PRESETS, resolvePresetRange, toLocalISO, type DatePreset } from './dateRanges';

interface Props {
  onViewAll: () => void;
}

const sum = (arr: number[]) => arr.reduce((s, n) => s + n, 0);

export default function ExpenseDashboardTab({ onViewAll }: Props) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [preset, setPreset] = useState<DatePreset>('This Month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [businessId, setBusinessId] = useState('');

  useEffect(() => {
    Promise.all([
      fetch('/api/expenses').then(r => r.json()),
      fetch('/api/businesses').then(r => r.json()),
    ]).then(([exp, biz]) => {
      setExpenses(exp.rows ?? []);
      setBusinesses(biz.rows ?? []);
      setLoading(false);
    });
  }, []);

  const range = resolvePresetRange(preset, customFrom, customTo);

  // Everything except the trend chart is scoped to the selected date range
  // (and business, if one is picked) — the trend chart deliberately ignores
  // the date-range filter since its whole job is showing change over many
  // months, same pattern as CEO Overview's trend chart in Service Center.
  const scoped = useMemo(() => expenses.filter(e => {
    if (businessId && String(e.business_id) !== businessId) return false;
    const d = e.date.slice(0, 10);
    return d >= range.from && d <= range.to;
  }), [expenses, businessId, range.from, range.to]);

  const totalAll = sum(scoped.map(e => e.amount));
  const bodega = businesses.find(b => b.name === 'Bodega ni Suki');
  const rpjEcom = businesses.find(b => b.name === 'RPJ ECOM');
  const totalBodega = sum(scoped.filter(e => bodega && e.business_id === bodega.id).map(e => e.amount));
  const totalRpjEcom = sum(scoped.filter(e => rpjEcom && e.business_id === rpjEcom.id).map(e => e.amount));

  const categoryTotals = EXPENSE_CATEGORIES.map(c => ({
    category: c,
    amount: sum(scoped.filter(e => e.category === c).map(e => e.amount)),
  }));

  const breakdown = categoryTotals
    .filter(c => c.amount > 0)
    .map(c => ({ ...c, pct: totalAll > 0 ? (c.amount / totalAll) * 100 : 0 }))
    .sort((a, b) => b.amount - a.amount);

  // Trend: Jan through the current month of the current year, business-filtered only.
  const trendData = useMemo(() => {
    const now = new Date();
    const points: { label: string; amount: number }[] = [];
    for (let m = 0; m <= now.getMonth(); m++) {
      const from = toLocalISO(new Date(now.getFullYear(), m, 1));
      const to = toLocalISO(new Date(now.getFullYear(), m + 1, 0));
      const monthExpenses = expenses.filter(e => {
        if (businessId && String(e.business_id) !== businessId) return false;
        const d = e.date.slice(0, 10);
        return d >= from && d <= to;
      });
      points.push({
        label: new Date(now.getFullYear(), m, 1).toLocaleDateString('en-PH', { month: 'short' }),
        amount: sum(monthExpenses.map(e => e.amount)),
      });
    }
    return points;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenses, businessId]);

  const recent = scoped.slice(0, 6);

  if (loading) return <div className="flex justify-center py-16"><Spinner /></div>;

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex items-center bg-gray-100 rounded-lg p-1 gap-0.5 w-fit flex-wrap">
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
        <select className="form-input py-1.5 text-sm w-auto" value={businessId} onChange={e => setBusinessId(e.target.value)}>
          <option value="">All Businesses</option>
          {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex items-center gap-4 sm:col-span-1">
          <div className="w-14 h-14 rounded-xl bg-gray-900 flex items-center justify-center shrink-0"><Wallet className="text-white" size={24} /></div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-500">Total Expenses</p>
            <p className="text-2xl font-bold text-gray-900 mt-1 tabular-nums">{formatCurrency(totalAll)}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-blue-50 flex items-center justify-center shrink-0"><Store className="text-blue-500" size={20} /></div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-500">Bodega ni Suki</p>
            <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">{formatCurrency(totalBodega)}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-orange-50 flex items-center justify-center shrink-0"><ShoppingBag className="text-orange-500" size={20} /></div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-500">RPJ ECOM</p>
            <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">{formatCurrency(totalRpjEcom)}</p>
          </div>
        </div>
      </div>

      {/* Category cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {categoryTotals.map(({ category, amount }) => {
          const Icon = CATEGORY_ICON[category];
          const color = CATEGORY_COLOR[category];
          return (
            <div key={category} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <div className={`w-9 h-9 rounded-lg ${color.bg} flex items-center justify-center mb-2`}>
                <Icon className={color.text} size={16} />
              </div>
              <p className="text-[11px] font-medium text-gray-500 truncate" title={category}>{category}</p>
              <p className="text-sm font-bold text-gray-900 mt-0.5 tabular-nums">{formatCurrency(amount)}</p>
            </div>
          );
        })}
      </div>

      {/* Trend + breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card">
          <p className="text-sm font-semibold text-gray-800 mb-1">Expense Trend</p>
          <p className="text-xs text-gray-400 mb-4">{new Date().getFullYear()}{businessId ? ` — ${businesses.find(b => String(b.id) === businessId)?.name}` : ' — All Businesses'}</p>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={trendData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} />
              <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} tickFormatter={v => `₱${(v / 1000).toFixed(0)}k`} width={50} />
              <Tooltip formatter={(val: number) => formatCurrency(val)} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Line type="monotone" dataKey="amount" name="Expenses" stroke="#F97316" strokeWidth={2.5} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <p className="text-sm font-semibold text-gray-800 mb-1">Where Your Money Went</p>
          <p className="text-xs text-gray-400 mb-2">Selected period</p>
          {breakdown.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-12">No expenses in this period.</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={breakdown} dataKey="amount" nameKey="category" innerRadius={45} outerRadius={70} paddingAngle={2}>
                    {breakdown.map(b => <Cell key={b.category} fill={CATEGORY_HEX[b.category]} />)}
                  </Pie>
                  <Tooltip formatter={(val: number) => formatCurrency(val)} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1.5 mt-2">
                {breakdown.map(b => (
                  <div key={b.category} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-gray-600">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: CATEGORY_HEX[b.category] }} />
                      {b.category}
                    </span>
                    <span className="font-semibold text-gray-800">{b.pct.toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Recent expenses */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-semibold text-gray-800">Recent Expenses</p>
          <button onClick={onViewAll} className="text-xs font-semibold text-orange-600 hover:text-orange-800">View All Transactions</button>
        </div>
        {recent.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">No expenses in this period yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  {['Date', 'Business', 'Category', 'Paid To', 'Amount', 'Status'].map(h => (
                    <th key={h} className="table-header">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recent.map((e, i) => (
                  <tr key={e.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="table-cell text-gray-500 whitespace-nowrap">{formatDate(e.date)}</td>
                    <td className="table-cell">{e.business_name || '—'}</td>
                    <td className="table-cell">{e.category}</td>
                    <td className="table-cell font-medium">{e.paid_to || '—'}</td>
                    <td className="table-cell font-semibold">{formatCurrency(e.amount)}</td>
                    <td className="table-cell"><span className={e.status === 'Verified' ? 'badge-green' : 'badge-amber'}>{e.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
