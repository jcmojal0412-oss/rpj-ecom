'use client';

import { useEffect, useState } from 'react';
import { Undo2, Loader2 } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import Spinner from '@/components/ui/Spinner';

interface Movement {
  id: number; moved_at: string; sku: string; name: string;
  type: 'IN' | 'OUT'; quantity: number; note: string;
  voided_at: string | null;
}

// Same Reason strings app/api/stock-movements(/bulk) always prefix a manual
// entry's note with — only those are voidable (see the void route's own
// comment for why sale/PO/bulk-count-driven movements are excluded).
const MANUAL_REASONS = [
  'New Purchase / Restock', 'Customer Return', 'RTS (Return to Sender)', 'Transfer In', 'Inventory Adjustment', 'Other',
  'Damaged / Defective', 'Supplier Return', 'Transfer Out', 'Online Order', 'Internal Use',
];
function isManualNote(note: string): boolean {
  return MANUAL_REASONS.some(r => note === r || note.startsWith(`${r}: `));
}

export default function MovementLog({ refreshKey, onVoided }: { refreshKey?: number; onVoided?: () => void }) {
  const [moves, setMoves] = useState<Movement[]>([]);
  const [days, setDays] = useState('7');
  const [loading, setLoading] = useState(true);
  const [isOwner, setIsOwner] = useState(false);
  const [voidingId, setVoidingId] = useState<number | null>(null);
  const [error, setError] = useState('');

  const fetchMoves = () => {
    setLoading(true);
    fetch(`/api/stock-movements?days=${days}`)
      .then(r => r.json())
      .then(d => { setMoves(Array.isArray(d) ? d : []); setLoading(false); });
  };

  useEffect(fetchMoves, [days, refreshKey]);
  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(u => setIsOwner(u?.role === 'owner'));
  }, []);

  const voidMovement = async (m: Movement) => {
    if (!confirm(`Void this ${m.type === 'IN' ? 'Stock In' : 'Stock Out'} of ${m.quantity} pcs — ${m.name}? This will reverse its effect on current stock.`)) return;
    setVoidingId(m.id);
    setError('');
    try {
      const res = await fetch(`/api/stock-movements/${m.id}/void`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to void this entry.'); return; }
      fetchMoves();
      onVoided?.();
    } finally {
      setVoidingId(null);
    }
  };

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

      {error && <p className="text-xs text-red-500 mb-3">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : moves.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">No movements in this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                {['Date','SKU','Product','Type','Qty','Note',''].map(h => (
                  <th key={h} className="table-header">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {moves.map((m, i) => {
                const voided = !!m.voided_at;
                const canVoid = isOwner && !voided && isManualNote(m.note);
                return (
                  <tr key={m.id} className={`${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'} ${voided ? 'opacity-50' : ''}`}>
                    <td className="table-cell text-gray-500 text-xs">{formatDate(m.moved_at)}</td>
                    <td className="table-cell font-mono text-xs font-semibold text-gray-600">{m.sku}</td>
                    <td className="table-cell">{m.name}</td>
                    <td className="table-cell">
                      <span className={m.type === 'IN' ? 'badge-green' : 'badge-red'}>{m.type}</span>
                    </td>
                    <td className={`table-cell text-right font-medium ${voided ? 'line-through' : ''}`}>{m.quantity}</td>
                    <td className="table-cell text-gray-500">
                      {m.note}
                      {voided && <span className="ml-2 badge-gray">VOIDED</span>}
                    </td>
                    <td className="table-cell">
                      {canVoid && (
                        <button
                          onClick={() => voidMovement(m)}
                          disabled={voidingId === m.id}
                          title="Void this entry — reverses its effect on current stock"
                          className="flex items-center gap-1 text-gray-400 hover:text-red-600 disabled:opacity-50 text-xs font-medium"
                        >
                          {voidingId === m.id ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} />}
                          Void
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
