'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Package } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { formatCurrency, formatDate, todayISO } from '@/lib/utils';
import Spinner from '@/components/ui/Spinner';
import { DATE_PRESETS, resolvePresetRange, type DatePreset } from '@/components/expenses/dateRanges';
import type { Business } from './constants';

interface Summary {
  totalSales: number; grossSales: number; discountTotal: number; deliveryFeeTotal: number; additionalFeeTotal: number;
  totalOrders: number; totalRefunds: number; netSales: number; cogs: number; totalExpenses: number; netIncome: number;
  byDay: { date: string; total: number; orders: number }[];
}
interface CashierRow { cashier_id: number | null; cashier_name: string | null; orders: number; total: number; }
interface MoverRow { product_id: number; product_name: string; sku: string | null; qty_sold: number; }

export default function PosReportsClient() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [preset, setPreset] = useState<DatePreset | null>('This Month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [businessId, setBusinessId] = useState('');

  const [summary, setSummary] = useState<Summary | null>(null);
  const [cashiers, setCashiers] = useState<CashierRow[]>([]);
  const [fastMovers, setFastMovers] = useState<MoverRow[]>([]);
  const [slowMovers, setSlowMovers] = useState<MoverRow[]>([]);
  const [inventoryValue, setInventoryValue] = useState(0);
  const [loading, setLoading] = useState(true);

  const range = preset ? resolvePresetRange(preset, customFrom, customTo) : null;

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (range) { params.set('from', range.from); params.set('to', range.to); }
    if (businessId) params.set('business_id', businessId);
    const qs = params.toString();
    const [s, c, m] = await Promise.all([
      fetch(`/api/pos/reports/summary?${qs}`).then(r => r.json()),
      fetch(`/api/pos/reports/cashiers?${qs}`).then(r => r.json()),
      fetch(`/api/pos/reports/fast-slow-movers?${qs}`).then(r => r.json()),
    ]);
    setSummary(s);
    setCashiers(c.rows ?? []);
    setFastMovers(m.fast ?? []);
    setSlowMovers(m.slow ?? []);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, customFrom, customTo, businessId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useEffect(() => {
    fetch('/api/businesses').then(r => r.json()).then(d => setBusinesses(d.rows ?? []));
    // Current-state figure, not date-ranged — same treatment as the main Dashboard.
    fetch('/api/inventory/summary').then(r => r.json()).then((rows: { inventory_value: number }[]) => {
      setInventoryValue((rows ?? []).reduce((sum, r) => sum + (r.inventory_value || 0), 0));
    });
  }, []);

  const chartData = (summary?.byDay ?? []).map(d => ({ ...d, label: formatDate(d.date) }));

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/pos" className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"><ArrowLeft size={18} /></Link>
        <div>
          <h1 className="text-xl font-bold text-gray-900">POS Reports</h1>
          <p className="text-sm text-gray-500">Sales summary, cashier performance, and top products</p>
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

      {loading || !summary ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="rounded-xl p-4 bg-slate-800 text-white">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-white/70">Gross Sales</p>
              <p className="text-xl font-bold tabular-nums mt-1">{formatCurrency(summary.grossSales)}</p>
              <p className="text-[11px] text-white/60 mt-2">{preset ?? 'All Dates'}</p>
            </div>

            <div className="rounded-xl p-4 bg-red-500 text-white">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-white/80">Less</p>
              <p className="text-xl font-bold tabular-nums mt-1">{formatCurrency(summary.discountTotal + summary.deliveryFeeTotal + summary.additionalFeeTotal)}</p>
              <div className="mt-2 space-y-0.5 text-[11px] text-white/85">
                <div className="flex justify-between"><span>Discount</span><span className="tabular-nums">{formatCurrency(summary.discountTotal)}</span></div>
                <div className="flex justify-between"><span>Delivery Fee</span><span className="tabular-nums">{formatCurrency(summary.deliveryFeeTotal)}</span></div>
                <div className="flex justify-between"><span>Additional Fee</span><span className="tabular-nums">{formatCurrency(summary.additionalFeeTotal)}</span></div>
              </div>
            </div>

            <div className="rounded-xl p-4 bg-amber-500 text-white">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-white/80">Total Expenses</p>
              <p className="text-xl font-bold tabular-nums mt-1">{formatCurrency(summary.totalExpenses + summary.cogs + summary.totalRefunds)}</p>
              <div className="mt-2 space-y-0.5 text-[11px] text-white/85">
                <div className="flex justify-between"><span>Expenses</span><span className="tabular-nums">{formatCurrency(summary.totalExpenses)}</span></div>
                <div className="flex justify-between"><span>COGS</span><span className="tabular-nums">{formatCurrency(summary.cogs)}</span></div>
                <div className="flex justify-between"><span>Refund</span><span className="tabular-nums">{formatCurrency(summary.totalRefunds)}</span></div>
              </div>
            </div>

            <div className="rounded-xl p-4 bg-violet-500 text-white">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-white/80">Net Income</p>
              <p className="text-xl font-bold tabular-nums mt-1">{formatCurrency(summary.netIncome)}</p>
              <p className="text-[11px] text-white/70 mt-2">{preset ?? 'All Dates'}</p>
            </div>

            <div className="rounded-xl p-4 bg-teal-500 text-white">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-white/80 flex items-center gap-1"><Package size={12} /> Total Inventory Value</p>
              <p className="text-xl font-bold tabular-nums mt-1">{formatCurrency(inventoryValue)}</p>
              <p className="text-[11px] text-white/70 mt-2">As of {formatDate(todayISO())}</p>
            </div>
          </div>

          <div className="card">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Sales Summary</h2>
            {chartData.length === 0 ? (
              <p className="text-center text-gray-400 text-sm py-8">No sales in this range.</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} tickFormatter={v => `₱${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Bar dataKey="total" name="Sales" fill="#f97316" radius={[4, 4, 0, 0]} maxBarSize={48} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-gray-900">Cashier&apos;s Report</h2>
              <Link href="/pos/reports/cashiers" className="text-xs font-semibold text-orange-600 hover:text-orange-800">View Full Report →</Link>
            </div>
            {cashiers.length === 0 ? (
              <p className="text-center text-gray-400 text-sm py-8">No sales in this range.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    {['Cashier', 'Orders', 'Total Sales'].map(h => <th key={h} className="table-header">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {cashiers.map((c, i) => (
                    <tr key={c.cashier_id ?? i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="table-cell font-medium">{c.cashier_name || '—'}</td>
                      <td className="table-cell tabular-nums">{c.orders}</td>
                      <td className="table-cell font-semibold tabular-nums">{formatCurrency(c.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold text-gray-900">Top 5 Fast Moving</h2>
                <Link href="/pos/reports/products" className="text-xs font-semibold text-orange-600 hover:text-orange-800">View Full Report →</Link>
              </div>
              {fastMovers.length === 0 ? (
                <p className="text-center text-gray-400 text-sm py-8">No sales in this range.</p>
              ) : (
                <div className="space-y-2">
                  {fastMovers.map(m => (
                    <div key={m.product_id} className="flex items-center gap-3 py-1.5">
                      <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center shrink-0"><Package size={16} className="text-gray-400" /></div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-800 truncate">{m.product_name}</p>
                        <p className="text-xs text-gray-400">{m.sku}</p>
                      </div>
                      <span className="text-sm font-bold text-gray-900 tabular-nums shrink-0">{m.qty_sold}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <h2 className="text-base font-semibold text-gray-900 mb-4">Top 5 Slow Moving</h2>
              {slowMovers.length === 0 ? (
                <p className="text-center text-gray-400 text-sm py-8">No products found.</p>
              ) : (
                <div className="space-y-2">
                  {slowMovers.map(m => (
                    <div key={m.product_id} className="flex items-center gap-3 py-1.5">
                      <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center shrink-0"><Package size={16} className="text-gray-400" /></div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-800 truncate">{m.product_name}</p>
                        <p className="text-xs text-gray-400">{m.sku}</p>
                      </div>
                      <span className="text-sm font-bold text-gray-900 tabular-nums shrink-0">{m.qty_sold}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
