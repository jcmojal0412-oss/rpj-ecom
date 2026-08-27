'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { formatCurrency } from '@/lib/utils';
import Spinner from '@/components/ui/Spinner';
import { DATE_PRESETS, resolvePresetRange, type DatePreset } from '@/components/expenses/dateRanges';
import type { Business } from '@/components/pos/constants';

interface PnL {
  revenue: number; refunds: number; netRevenue: number; cogs: number;
  grossProfit: number; grossMarginPct: number;
  expensesByCategory: { category: string; amount: number }[];
  totalExpenses: number; netProfit: number; netMarginPct: number;
}

export default function ProfitLossClient() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [preset, setPreset] = useState<DatePreset | null>('This Month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [businessId, setBusinessId] = useState('');

  const [data, setData] = useState<PnL | null>(null);
  const [loading, setLoading] = useState(true);

  const range = preset ? resolvePresetRange(preset, customFrom, customTo) : null;

  const fetchData = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (range) { params.set('from', range.from); params.set('to', range.to); }
    if (businessId) params.set('business_id', businessId);
    const d = await fetch(`/api/reports/profit-loss?${params.toString()}`).then(r => r.json());
    setData(d);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, customFrom, customTo, businessId]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    fetch('/api/businesses').then(r => r.json()).then(d => setBusinesses(d.rows ?? []));
  }, []);

  const chartData = data ? [
    { name: 'Revenue', value: data.netRevenue, color: '#f97316' },
    { name: 'COGS', value: data.cogs, color: '#f59e0b' },
    { name: 'Expenses', value: data.totalExpenses, color: '#ef4444' },
    { name: 'Net Profit', value: data.netProfit, color: data.netProfit >= 0 ? '#10b981' : '#ef4444' },
  ] : [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/reports" className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"><ArrowLeft size={18} /></Link>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Profit &amp; Loss Report</h1>
          <p className="text-sm text-gray-500">POS revenue, cost of goods, and operating expenses</p>
        </div>
      </div>

      <div className="card space-y-3">
        <div className="flex items-center bg-gray-100 rounded-lg p-1 gap-0.5 w-fit flex-wrap">
          <button onClick={() => setPreset(null)}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${!preset ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
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
        <select className="form-input py-1.5 text-sm w-auto" value={businessId} onChange={e => setBusinessId(e.target.value)}>
          <option value="">All Businesses</option>
          {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>

      {loading || !data ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : (
        <div className="grid lg:grid-cols-2 gap-6">
          {/* Statement */}
          <div className="card">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Statement</h2>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-gray-600">Revenue (POS Sales)</span><span className="tabular-nums">{formatCurrency(data.revenue)}</span></div>
              <div className="flex justify-between pl-4"><span className="text-gray-500">Less: Refunds</span><span className="tabular-nums text-red-500">-{formatCurrency(data.refunds)}</span></div>
              <div className="flex justify-between font-semibold pt-1.5 border-t border-gray-100"><span>Net Revenue</span><span className="tabular-nums">{formatCurrency(data.netRevenue)}</span></div>

              <div className="flex justify-between pt-2"><span className="text-gray-500">Less: Cost of Goods Sold</span><span className="tabular-nums text-red-500">-{formatCurrency(data.cogs)}</span></div>
              <div className="flex justify-between font-bold text-base pt-1.5 border-t border-gray-100">
                <span>Gross Profit</span>
                <span className="tabular-nums">{formatCurrency(data.grossProfit)} <span className="text-xs font-normal text-gray-400">({data.grossMarginPct.toFixed(1)}%)</span></span>
              </div>

              <div className="pt-2">
                <div className="flex justify-between"><span className="text-gray-500">Less: Operating Expenses</span><span className="tabular-nums text-red-500">-{formatCurrency(data.totalExpenses)}</span></div>
                {data.expensesByCategory.map(e => (
                  <div key={e.category} className="flex justify-between pl-4 text-xs text-gray-400">
                    <span>{e.category}</span><span className="tabular-nums">{formatCurrency(e.amount)}</span>
                  </div>
                ))}
              </div>

              <div className={`flex justify-between font-bold text-lg pt-2 border-t-2 border-gray-200 ${data.netProfit >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                <span>Net Profit</span>
                <span className="tabular-nums">{formatCurrency(data.netProfit)} <span className="text-xs font-normal text-gray-400">({data.netMarginPct.toFixed(1)}%)</span></span>
              </div>
            </div>
          </div>

          {/* Chart */}
          <div className="card">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Overview</h2>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#6b7280' }} />
                <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} tickFormatter={v => `₱${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={70}>
                  {chartData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
