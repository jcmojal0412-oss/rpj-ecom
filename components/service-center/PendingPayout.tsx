'use client';

import { useState } from 'react';
import { CheckCircle2, Loader2, Wallet } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import type { Repair } from './ServiceCenterClient';
import { toLocalISO, weekStart, weekLabel } from './weekUtils';

interface Props {
  repairs: Repair[];
  onPaid: () => void;
}

export default function PendingPayout({ repairs, onPaid }: Props) {
  const [payingWeek, setPayingWeek] = useState<string | null>(null);

  const pending = repairs.filter(r => r.status === 'CUSTOMER PAID' && !r.paid_to_tech);

  const groups = new Map<string, { monday: Date; items: Repair[] }>();
  for (const r of pending) {
    const monday = weekStart(r.repair_date.slice(0, 10));
    const key = toLocalISO(monday);
    if (!groups.has(key)) groups.set(key, { monday, items: [] });
    groups.get(key)!.items.push(r);
  }
  const sortedGroups = [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]));

  const payWeek = async (key: string, items: Repair[]) => {
    setPayingWeek(key);
    try {
      const today = toLocalISO(new Date());
      for (const r of items) {
        await fetch(`/api/service-repairs/${r.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            repair_date: r.repair_date, repair_details: r.repair_details, unit_model: r.unit_model,
            cs_payment: r.cs_payment, cogs: r.cogs, dp: r.dp, status: r.status,
            paid_to_tech: true, tech_paid_date: today,
          }),
        });
      }
      onPaid();
    } finally {
      setPayingWeek(null);
    }
  };

  if (pending.length === 0) {
    return (
      <div className="card">
        <div className="flex items-center gap-2 mb-1">
          <Wallet className="text-amber-500" size={20} />
          <h2 className="text-base font-semibold text-gray-900">Pending Payout to Tech</h2>
        </div>
        <p className="text-sm text-gray-400 py-4">Nothing pending — all customer-paid jobs are settled with the technician.</p>
      </div>
    );
  }

  return (
    <div className="card space-y-5">
      <div className="flex items-center gap-2">
        <Wallet className="text-amber-500" size={20} />
        <div>
          <h2 className="text-base font-semibold text-gray-900">Pending Payout to Tech</h2>
          <p className="text-xs text-gray-400">Customer-paid jobs not yet settled with the technician — cutoff Monday to Sunday</p>
        </div>
      </div>

      <div className="space-y-4">
        {sortedGroups.map(([key, { monday, items }]) => {
          const subtotal = items.reduce((s, r) => s + r.gerald_share, 0);
          return (
            <div key={key} className="border border-amber-100 bg-amber-50/40 rounded-xl p-4">
              <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                <div>
                  <p className="text-sm font-semibold text-gray-800">{weekLabel(monday)}</p>
                  <p className="text-xs text-gray-500">{items.length} job{items.length > 1 ? 's' : ''} · {formatCurrency(subtotal)} owed</p>
                </div>
                <button
                  onClick={() => payWeek(key, items)}
                  disabled={payingWeek === key}
                  className="btn-primary text-xs py-1.5 disabled:opacity-50"
                >
                  {payingWeek === key ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                  {payingWeek === key ? 'Marking Paid...' : 'Mark Week as Paid'}
                </button>
              </div>
              <div className="space-y-1.5">
                {items.map(r => (
                  <div key={r.id} className="flex items-center justify-between text-xs bg-white rounded-lg px-3 py-2">
                    <div className="min-w-0">
                      <span className="text-gray-400">{formatDate(r.repair_date)}</span>{' '}
                      <span className="font-medium text-gray-700">{r.repair_details || r.unit_model || '—'}</span>
                      {r.unit_model && r.repair_details && <span className="text-gray-400"> · {r.unit_model}</span>}
                    </div>
                    <span className="font-semibold text-amber-700 shrink-0 ml-3">{formatCurrency(r.gerald_share)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between text-xs px-3 pt-2 mt-1 border-t border-amber-200">
                  <span className="font-semibold text-gray-700">Total</span>
                  <span className="font-bold text-amber-800">{formatCurrency(subtotal)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
