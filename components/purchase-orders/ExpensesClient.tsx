'use client';

import { useEffect, useState } from 'react';
import { formatCurrency } from '@/lib/utils';
import Spinner from '@/components/ui/Spinner';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

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

function formatMonth(m: string) {
  const [y, mo] = m.split('-');
  const date = new Date(parseInt(y), parseInt(mo) - 1);
  return date.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
}

export default function ExpensesClient() {
  const [monthly, setMonthly] = useState<MonthlyRow[]>([]);
  const [totals, setTotals]   = useState<Totals | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/reports/monthly-expenses').then(r => r.json()).then(d => {
      setMonthly(d.monthly ?? []);
      setTotals(d.totals ?? null);
      setLoading(false);
    });
  }, []);

  if (loading) return <div className="flex items-center justify-center h-full"><Spinner size={36} /></div>;

  const chartData = [...monthly].reverse().map(r => ({
    month: formatMonth(r.month).replace(' 2026', '').replace(' 2025', ''),
    Ordered: r.total_ordered,
    Paid: r.total_paid,
    Outstanding: r.outstanding,
  }));

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Monthly Expenses</h1>
        <p className="text-sm text-gray-500 mt-1">Track supplier payments and outstanding balances</p>
      </div>

      {/* Summary KPIs */}
      {totals && (
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
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Monthly Spending Overview</h2>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `₱${(v/1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Legend />
              <Bar dataKey="Ordered" fill="#94a3b8" radius={[4,4,0,0]} maxBarSize={40} />
              <Bar dataKey="Paid" fill="#22c55e" radius={[4,4,0,0]} maxBarSize={40} />
              <Bar dataKey="Outstanding" fill="#ef4444" radius={[4,4,0,0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Monthly table */}
      <div className="card">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Monthly Breakdown</h2>
        {monthly.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">No purchase orders yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  {['Month', 'Orders', 'Total Ordered', 'Total Paid', 'Outstanding', 'Status'].map(h => (
                    <th key={h} className="table-header">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {monthly.map((row, i) => {
                  const pct = row.total_ordered > 0 ? (row.total_paid / row.total_ordered * 100) : 0;
                  const status = pct >= 100 ? 'Fully Paid' : pct > 0 ? 'Partial' : 'Unpaid';
                  const statusColor = status === 'Fully Paid' ? 'badge-green' : status === 'Partial' ? 'badge-amber' : 'badge-red';
                  return (
                    <tr key={row.month} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="table-cell font-semibold">{formatMonth(row.month)}</td>
                      <td className="table-cell text-center">{row.order_count}</td>
                      <td className="table-cell font-medium">{formatCurrency(row.total_ordered)}</td>
                      <td className="table-cell text-green-700 font-medium">{formatCurrency(row.total_paid)}</td>
                      <td className="table-cell text-red-600 font-medium">
                        {row.outstanding > 0 ? formatCurrency(row.outstanding) : '—'}
                      </td>
                      <td className="table-cell">
                        <div>
                          <span className={statusColor}>{status}</span>
                          {pct > 0 && pct < 100 && (
                            <div className="mt-1 w-20 bg-gray-200 rounded-full h-1.5">
                              <div className="bg-green-500 h-1.5 rounded-full" style={{ width: `${pct}%` }} />
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
