'use client';

import { useEffect, useState, useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';
import { todayISO } from '@/lib/utils';

interface NegativeRow { id: number; sku: string; name: string; category: string | null; quantity: number; }

export default function NegativeStockPanel({ refreshKey }: { refreshKey?: number }) {
  const [asOf, setAsOf] = useState(todayISO());
  const [rows, setRows] = useState<NegativeRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const data = await fetch(`/api/inventory/negative-stock?as_of=${asOf}`).then(r => r.json());
    setRows(data.rows ?? []);
    setLoading(false);
  }, [asOf]);

  useEffect(() => { fetchRows(); }, [fetchRows, refreshKey]);

  return (
    <div className="card !border-red-200">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div className="flex items-center gap-2">
          <AlertTriangle size={18} className="text-red-600" />
          <h2 className="text-base font-semibold text-gray-900">
            Negative Stock {!loading && <span className="text-red-600">({rows.length})</span>}
          </h2>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <label className="text-gray-500">As of</label>
          <input type="date" className="form-input w-auto text-xs py-1" value={asOf} onChange={e => setAsOf(e.target.value)} />
          {asOf !== todayISO() && (
            <button onClick={() => setAsOf(todayISO())} className="text-orange-600 hover:text-orange-800 font-medium">Today</button>
          )}
        </div>
      </div>

      <p className="text-xs text-gray-400 mb-3">
        Products physically impossible to be below zero, but recorded as such — usually from a sale processed
        while &quot;Allow selling at 0 stock&quot; was on in POS. These need a real physical count, then a fix via
        <span className="font-medium text-gray-600"> Edit Stock</span> below (not Stock In — that only adds to
        whatever is on file, which can undershoot if the starting point was already negative).
      </p>

      {loading ? (
        <div className="flex justify-center py-8"><span className="text-sm text-gray-400">Loading...</span></div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">
          No negative-stock products as of {asOf === todayISO() ? 'today' : asOf}. 🎉
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                {['SKU', 'Product Name', 'Category', 'Quantity'].map(h => (
                  <th key={h} className="table-header">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} className={i % 2 === 0 ? 'bg-white' : 'bg-red-50/40'}>
                  <td className="table-cell font-mono text-xs font-semibold text-gray-600">{r.sku}</td>
                  <td className="table-cell font-medium">{r.name}</td>
                  <td className="table-cell text-gray-500">{r.category ?? '—'}</td>
                  <td className="table-cell text-right">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-600 text-white">
                      {r.quantity}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
