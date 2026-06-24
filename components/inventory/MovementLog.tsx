'use client';

import { useEffect, useState } from 'react';
import { formatDate } from '@/lib/utils';
import Spinner from '@/components/ui/Spinner';

interface Movement {
  id: number; moved_at: string; sku: string; name: string;
  type: 'IN' | 'OUT'; quantity: number; note: string;
}

export default function MovementLog() {
  const [moves, setMoves] = useState<Movement[]>([]);
  const [days, setDays] = useState('7');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/stock-movements?days=${days}`)
      .then(r => r.json())
      .then(d => { setMoves(d); setLoading(false); });
  }, [days]);

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-gray-900">Stock Movement Log</h2>
        <select
          className="form-input w-auto text-xs"
          value={days}
          onChange={e => setDays(e.target.value)}
        >
          <option value="7">Last 7 days</option>
          <option value="14">Last 14 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : moves.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">No movements in this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                {['Date','SKU','Product','Type','Qty','Note'].map(h => (
                  <th key={h} className="table-header">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {moves.map((m, i) => (
                <tr key={m.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="table-cell text-gray-500 text-xs">{formatDate(m.moved_at)}</td>
                  <td className="table-cell font-mono text-xs font-semibold text-gray-600">{m.sku}</td>
                  <td className="table-cell">{m.name}</td>
                  <td className="table-cell">
                    <span className={m.type === 'IN' ? 'badge-green' : 'badge-red'}>{m.type}</span>
                  </td>
                  <td className="table-cell text-right font-medium">{m.quantity}</td>
                  <td className="table-cell text-gray-500">{m.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
