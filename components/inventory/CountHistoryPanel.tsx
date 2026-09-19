'use client';

import { useEffect, useState } from 'react';
import { formatCurrency, formatDate } from '@/lib/utils';
import Spinner from '@/components/ui/Spinner';

interface CountRow {
  id: number; counted_at: string; sku: string; name: string;
  expected_qty: number; counted_qty: number; variance: number; variance_value: number;
  reason: string | null; note: string | null; source: string; counted_by_name: string | null;
}
interface Summary {
  total_counts: number; matched: number; accuracy_pct: number | null;
  shrink_value: number; overage_value: number; net_value: number;
}
interface RepeatRow { sku: string; name: string; times: number; net_units: number; net_value: number; }

const varianceClass = (v: number) => v === 0 ? 'text-gray-500' : v < 0 ? 'text-red-600' : 'text-amber-600';
const signed = (v: number) => (v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : '0');

export default function CountHistoryPanel({ refreshKey }: { refreshKey?: number }) {
  const [days, setDays] = useState('30');
  const [rows, setRows] = useState<CountRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [repeat, setRepeat] = useState<RepeatRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [onlyVariance, setOnlyVariance] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/inventory/counts?days=${days}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        setRows(d?.rows ?? []);
        setSummary(d?.summary ?? null);
        setRepeat(d?.repeat ?? []);
        setLoading(false);
      });
  }, [days, refreshKey]);

  const shown = onlyVariance ? rows.filter(r => r.variance !== 0) : rows;
  const reasonLabel = (r: CountRow) => r.reason ?? (r.source === 'bulk' ? 'Bulk count sheet' : '—');

  return (
    <div className="card p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Stock Count History</h2>
          <p className="text-xs text-gray-400 mt-0.5">What the system expected vs. what was actually counted</p>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto">
          <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none py-1">
            <input type="checkbox" className="rounded border-gray-300 text-orange-500" checked={onlyVariance} onChange={e => setOnlyVariance(e.target.checked)} />
            Only show differences
          </label>
          <select className="form-input w-full sm:w-auto text-sm sm:text-xs" value={days} onChange={e => setDays(e.target.value)}>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="365">Last 365 days</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : !summary || summary.total_counts === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">
          No counts recorded in this period yet. Use “Count Stock” on any product to start.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <div className="rounded-xl bg-gray-50 p-3">
              <p className="text-[11px] text-gray-500 font-medium">Count accuracy</p>
              <p className={`text-2xl font-bold tabular-nums ${(summary.accuracy_pct ?? 0) >= 95 ? 'text-emerald-600' : (summary.accuracy_pct ?? 0) >= 85 ? 'text-amber-600' : 'text-red-600'}`}>
                {summary.accuracy_pct === null ? '—' : `${summary.accuracy_pct.toFixed(1)}%`}
              </p>
              <p className="text-[11px] text-gray-400">{summary.matched} of {summary.total_counts} counts matched</p>
            </div>
            <div className="rounded-xl bg-gray-50 p-3">
              <p className="text-[11px] text-gray-500 font-medium">Shortage (at cost)</p>
              <p className="text-2xl font-bold tabular-nums text-red-600">{formatCurrency(summary.shrink_value)}</p>
            </div>
            <div className="rounded-xl bg-gray-50 p-3">
              <p className="text-[11px] text-gray-500 font-medium">Overage (at cost)</p>
              <p className="text-2xl font-bold tabular-nums text-amber-600">{formatCurrency(summary.overage_value)}</p>
            </div>
            <div className="rounded-xl bg-gray-50 p-3">
              <p className="text-[11px] text-gray-500 font-medium">Net difference</p>
              <p className={`text-2xl font-bold tabular-nums ${summary.net_value < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                {summary.net_value < 0 ? '−' : ''}{formatCurrency(Math.abs(summary.net_value))}
              </p>
            </div>
          </div>

          {repeat.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 mb-4">
              <p className="text-xs font-semibold text-amber-900 mb-1.5">Products that keep not matching — worth investigating</p>
              <ul className="space-y-1">
                {repeat.map(r => (
                  <li key={r.sku} className="flex items-center justify-between gap-3 text-xs text-amber-900">
                    <span className="min-w-0 truncate"><span className="font-mono font-semibold">{r.sku}</span> · {r.name}</span>
                    <span className="shrink-0 tabular-nums">{r.times}× off · net {signed(r.net_units)} pcs</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {shown.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">No differences found in this period.</p>
          ) : (
            <>
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      {['Date', 'SKU', 'Product', 'System', 'Counted', 'Diff', 'Value', 'Reason', 'By'].map(h => (
                        <th key={h} className="table-header whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r, i) => (
                      <tr key={r.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="table-cell text-gray-500 text-xs whitespace-nowrap">{formatDate(r.counted_at)}</td>
                        <td className="table-cell font-mono text-xs font-semibold text-gray-600">{r.sku}</td>
                        <td className="table-cell">{r.name}</td>
                        <td className="table-cell text-right tabular-nums">{r.expected_qty}</td>
                        <td className="table-cell text-right tabular-nums font-medium">{r.counted_qty}</td>
                        <td className={`table-cell text-right tabular-nums font-semibold ${varianceClass(r.variance)}`}>{signed(r.variance)}</td>
                        <td className={`table-cell text-right tabular-nums ${varianceClass(r.variance)}`}>
                          {r.variance === 0 ? '—' : `${r.variance < 0 ? '−' : '+'}${formatCurrency(Math.abs(r.variance_value))}`}
                        </td>
                        <td className="table-cell text-gray-500 text-xs">{reasonLabel(r)}{r.note ? ` — ${r.note}` : ''}</td>
                        <td className="table-cell text-gray-500 text-xs whitespace-nowrap">{r.counted_by_name ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Phone: the 9-column table can't fit, so each count becomes a card. */}
              <div className="md:hidden space-y-2">
                {shown.map(r => (
                  <div key={r.id} className="rounded-xl border border-gray-200 bg-white p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">{r.name}</p>
                        <p className="text-[11px] text-gray-400 font-mono">{r.sku} · {formatDate(r.counted_at)}</p>
                      </div>
                      <p className={`text-base font-bold tabular-nums shrink-0 ${varianceClass(r.variance)}`}>{signed(r.variance)}</p>
                    </div>
                    <p className="text-xs text-gray-600 mt-1.5 tabular-nums">
                      System {r.expected_qty} → Counted <span className="font-semibold">{r.counted_qty}</span>
                      {r.variance !== 0 && <span className={varianceClass(r.variance)}> ({r.variance < 0 ? '−' : '+'}{formatCurrency(Math.abs(r.variance_value))})</span>}
                    </p>
                    <p className="text-[11px] text-gray-400 mt-1">{reasonLabel(r)}{r.note ? ` — ${r.note}` : ''}{r.counted_by_name ? ` · ${r.counted_by_name}` : ''}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
