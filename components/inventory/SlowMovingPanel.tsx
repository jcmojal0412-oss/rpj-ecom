'use client';

import { useEffect, useState, useCallback } from 'react';
import { TrendingDown, ChevronDown, ChevronUp } from 'lucide-react';

interface SlowRow { id: number; sku: string; name: string; category: string | null; quantity: number; qty_sold: number; }

const DAY_OPTIONS = [30, 60, 90] as const;

export default function SlowMovingPanel({ refreshKey }: { refreshKey?: number }) {
  const [days, setDays] = useState<number>(60);
  const [rows, setRows] = useState<SlowRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(true);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const data = await fetch(`/api/inventory/slow-moving?days=${days}&limit=20`).then(r => r.json());
    setRows(data.rows ?? []);
    setLoading(false);
  }, [days]);

  useEffect(() => { fetchRows(); }, [fetchRows, refreshKey]);

  return (
    <div className="card">
      <button
        type="button"
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center justify-between flex-wrap gap-3 text-left"
      >
        <div className="flex items-center gap-2">
          <TrendingDown size={18} className="text-amber-600" />
          <h2 className="text-base font-semibold text-gray-900">Slow Moving / Dead Stock</h2>
        </div>
        <span className="flex items-center gap-1 text-xs text-gray-400">
          {collapsed ? 'Show' : 'Hide'}
          {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </span>
      </button>

      {!collapsed && (
        <div className="mt-4">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
            <p className="text-xs text-gray-400 max-w-md">
              Products still in stock, ranked by least sold in the window below — biggest remaining
              stock first among the slowest sellers, so this is priority order for what to push or promote.
            </p>
            <div className="flex items-center gap-1 text-xs shrink-0">
              {DAY_OPTIONS.map(d => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                    days === d ? 'bg-amber-100 text-amber-800' : 'text-gray-500 hover:bg-gray-100'
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-8"><span className="text-sm text-gray-400">Loading...</span></div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No in-stock products to rank yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    {['SKU', 'Product Name', 'Category', 'Stock', `Sold (${days}d)`].map(h => (
                      <th key={h} className="table-header">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.id} className={i % 2 === 0 ? 'bg-white' : 'bg-amber-50/40'}>
                      <td className="table-cell font-mono text-xs font-semibold text-gray-600">{r.sku}</td>
                      <td className="table-cell font-medium">{r.name}</td>
                      <td className="table-cell text-gray-500">{r.category ?? '—'}</td>
                      <td className="table-cell text-right font-semibold">{r.quantity}</td>
                      <td className="table-cell text-right">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${
                          r.qty_sold === 0 ? 'bg-amber-600 text-white' : 'bg-amber-100 text-amber-800'
                        }`}>
                          {r.qty_sold}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
