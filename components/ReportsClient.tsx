'use client';

import { useEffect, useState } from 'react';
import { formatCurrency, formatDate } from '@/lib/utils';
import Spinner from '@/components/ui/Spinner';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface InventoryItem {
  id: number; sku: string; name: string; category: string;
  cogs: number; srp: number; quantity: number; reorder_point: number;
  last_updated: string;
}

interface Movement {
  id: number; moved_at: string; sku: string; name: string;
  type: 'IN' | 'OUT'; quantity: number; note: string; product_id: number;
}

export default function ReportsClient() {
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/inventory').then(r => r.json()),
      fetch('/api/stock-movements?days=90').then(r => r.json()),
    ]).then(([inv, mov]) => {
      setInventory(inv);
      setMovements(mov);
      setLoading(false);
    });
  }, []);

  if (loading) return <div className="flex items-center justify-center h-full"><Spinner size={36} /></div>;

  // Monthly inventory value by category
  const categories = Array.from(new Set(inventory.map(i => i.category))).filter(Boolean);
  const categoryData = categories.map(cat => {
    const items = inventory.filter(i => i.category === cat);
    return {
      category: cat,
      value: items.reduce((s, i) => s + i.quantity * i.cogs, 0),
      items: items.length,
    };
  });

  // Stock Aging: days since last stock out
  const lastOutByProduct: Record<number, string> = {};
  for (const m of movements) {
    if (m.type === 'OUT') {
      if (!lastOutByProduct[m.product_id] || m.moved_at > lastOutByProduct[m.product_id]) {
        lastOutByProduct[m.product_id] = m.moved_at;
      }
    }
  }

  const now = Date.now();
  const agingRows = inventory.map(item => {
    const lastOut = lastOutByProduct[item.id];
    const daysSince = lastOut
      ? Math.floor((now - new Date(lastOut).getTime()) / 86400000)
      : 999;
    let flag = '';
    if (daysSince >= 90) flag = '90+ days';
    else if (daysSince >= 60) flag = '60+ days';
    else if (daysSince >= 30) flag = '30+ days';
    return { ...item, daysSince, lastOut: lastOut ?? null, flag };
  }).sort((a, b) => b.daysSince - a.daysSince);

  // Shrinkage: total IN vs current qty
  const inByProduct: Record<number, number> = {};
  const outByProduct: Record<number, number> = {};
  for (const m of movements) {
    if (m.type === 'IN') inByProduct[m.product_id] = (inByProduct[m.product_id] ?? 0) + m.quantity;
    if (m.type === 'OUT') outByProduct[m.product_id] = (outByProduct[m.product_id] ?? 0) + m.quantity;
  }

  const shrinkageRows = inventory.map(item => {
    const totalIn = inByProduct[item.id] ?? 0;
    const totalOut = outByProduct[item.id] ?? 0;
    const expected = totalIn - totalOut;
    const actual = item.quantity;
    const shrinkage = expected - actual;
    return { ...item, totalIn, totalOut, expected, actual, shrinkage };
  }).filter(r => r.shrinkage !== 0);

  return (
    <div className="p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
        <p className="text-sm text-gray-500 mt-1">Inventory analytics and audit reports</p>
      </div>

      {/* Category Value Chart */}
      <div className="card">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Inventory Value by Category</h2>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={categoryData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis dataKey="category" tick={{ fontSize: 12, fill: '#6b7280' }} />
            <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} tickFormatter={v => `₱${(v/1000).toFixed(0)}k`} />
            <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
            <Bar dataKey="value" name="Inventory Value" fill="#16a34a" radius={[4,4,0,0]} maxBarSize={60} />
          </BarChart>
        </ResponsiveContainer>
        <div className="mt-4 grid grid-cols-3 gap-4">
          {categoryData.map(cat => (
            <div key={cat.category} className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-500">{cat.category}</p>
              <p className="text-lg font-bold text-gray-900">{formatCurrency(cat.value)}</p>
              <p className="text-xs text-gray-500">{cat.items} SKUs</p>
            </div>
          ))}
        </div>
      </div>

      {/* Stock Aging */}
      <div className="card">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Stock Aging Report</h2>
        <p className="text-xs text-gray-500 mb-3">Days since last stock out. Flagged at 30/60/90+ days.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                {['SKU','Product','Category','Current Stock','Last Stock Out','Days Since Out','Flag'].map(h => (
                  <th key={h} className="table-header">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {agingRows.slice(0, 20).map((row, i) => (
                <tr key={row.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="table-cell font-mono text-xs font-semibold text-gray-600">{row.sku}</td>
                  <td className="table-cell font-medium">{row.name}</td>
                  <td className="table-cell text-gray-500">{row.category}</td>
                  <td className="table-cell text-right font-semibold">{row.quantity}</td>
                  <td className="table-cell text-gray-500">{row.lastOut ? formatDate(row.lastOut) : 'Never'}</td>
                  <td className="table-cell text-right">{row.daysSince === 999 ? '—' : row.daysSince}</td>
                  <td className="table-cell">
                    {row.flag === '90+ days' && <span className="badge-red">{row.flag}</span>}
                    {row.flag === '60+ days' && <span className="badge-amber">{row.flag}</span>}
                    {row.flag === '30+ days' && <span className="badge-gray">{row.flag}</span>}
                    {!row.flag && <span className="text-green-600 text-xs font-medium">Active</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Shrinkage Audit */}
      <div className="card">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Inventory Shrinkage Audit</h2>
        <p className="text-xs text-gray-500 mb-3">
          Products where expected stock (IN − OUT) doesn't match actual quantity on hand (last 90 days).
        </p>
        {shrinkageRows.length === 0 ? (
          <p className="text-sm text-green-700 font-medium">✓ No shrinkage detected across all products.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  {['SKU','Product','Total IN','Total OUT','Expected','Actual','Shrinkage'].map(h => (
                    <th key={h} className="table-header">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shrinkageRows.map((row, i) => (
                  <tr key={row.id} className={i % 2 === 0 ? 'bg-white' : 'bg-red-50'}>
                    <td className="table-cell font-mono text-xs font-semibold text-gray-600">{row.sku}</td>
                    <td className="table-cell font-medium">{row.name}</td>
                    <td className="table-cell text-right text-green-700">{row.totalIn}</td>
                    <td className="table-cell text-right text-red-600">{row.totalOut}</td>
                    <td className="table-cell text-right">{row.expected}</td>
                    <td className="table-cell text-right font-semibold">{row.actual}</td>
                    <td className="table-cell text-right font-bold text-red-700">{row.shrinkage > 0 ? `-${row.shrinkage}` : `+${Math.abs(row.shrinkage)}`}</td>
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
