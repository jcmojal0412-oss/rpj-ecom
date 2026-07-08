'use client';

import { useState } from 'react';
import { CheckCircle2, Loader2, AlertTriangle } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import type { Repair } from './ServiceCenterClient';
import { toLocalISO, weekStart, weekLabel, isCurrentWeek } from './weekUtils';

interface Props {
  repairs: Repair[];
  onSettled: () => void;
}

export default function LateCustomerPayments({ repairs, onSettled }: Props) {
  const [payingWeek, setPayingWeek] = useState<string | null>(null);

  const unpaid = repairs.filter(r => r.status === 'ONGOING');

  const groups = new Map<string, { monday: Date; items: Repair[] }>();
  for (const r of unpaid) {
    const monday = weekStart(r.repair_date.slice(0, 10));
    const key = toLocalISO(monday);
    if (!groups.has(key)) groups.set(key, { monday, items: [] });
    groups.get(key)!.items.push(r);
  }
  const sortedGroups = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const lateGroups = sortedGroups.filter(([, g]) => !isCurrentWeek(g.monday));

  const markPaid = async (key: string, items: Repair[]) => {
    setPayingWeek(key);
    try {
      for (const r of items) {
        await fetch(`/api/service-repairs/${r.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            repair_date: r.repair_date, repair_details: r.repair_details, unit_model: r.unit_model,
            cs_payment: r.cs_payment, cogs: r.cogs, dp: r.dp, status: 'CUSTOMER PAID',
            paid_to_tech: r.paid_to_tech, tech_paid_date: r.tech_paid_date,
          }),
        });
      }
      onSettled();
    } finally {
      setPayingWeek(null);
    }
  };

  if (lateGroups.length === 0) {
    return (
      <div className="card">
        <div className="flex items-center gap-2 mb-1">
          <AlertTriangle className="text-red-500" size={20} />
          <h2 className="text-base font-semibold text-gray-900">Late Customer Payments</h2>
        </div>
        <p className="text-sm text-gray-400 py-4">No overdue balances — nothing carried over from previous weeks.</p>
      </div>
    );
  }

  return (
    <div className="card space-y-5">
      <div className="flex items-center gap-2">
        <AlertTriangle className="text-red-500" size={20} />
        <div>
          <h2 className="text-base font-semibold text-gray-900">Late Customer Payments</h2>
          <p className="text-xs text-gray-400">Jobs still marked Ongoing from previous weeks — customer balance not yet collected</p>
        </div>
      </div>

      <div className="space-y-4">
        {lateGroups.map(([key, { monday, items }]) => {
          const subtotal = items.reduce((s, r) => s + r.cs_payment, 0);
          return (
            <div key={key} className="border border-red-200 bg-red-50/40 rounded-xl p-4">
              <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                <div>
                  <p className="text-sm font-semibold text-gray-800">{weekLabel(monday)}</p>
                  <p className="text-xs text-red-600 font-medium">{items.length} job{items.length > 1 ? 's' : ''} · {formatCurrency(subtotal)} outstanding</p>
                </div>
                <button
                  onClick={() => markPaid(key, items)}
                  disabled={payingWeek === key}
                  className="btn-primary text-xs py-1.5 disabled:opacity-50"
                >
                  {payingWeek === key ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                  {payingWeek === key ? 'Marking Paid...' : 'Mark Week as Customer Paid'}
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
                    <span className="font-semibold text-red-700 shrink-0 ml-3">{formatCurrency(r.cs_payment)}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
