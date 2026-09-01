'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Printer, Copy, FileSpreadsheet, Download, ArrowUpDown, ChevronLeft, ChevronRight, Wrench, Loader2 } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import Spinner from '@/components/ui/Spinner';
import { Toast, useToast } from '@/components/ui/Toast';
import { DATE_PRESETS, resolvePresetRange, type DatePreset } from '@/components/expenses/dateRanges';
import type { Business } from './constants';

interface CashierOption { cashier_id: number | null; cashier_name: string | null; }
interface MethodRow { payment_method: string; count: number; total: number; }
interface MethodSale {
  id: number; created_at: string; payment_method: string | null; total: number;
  cashier_name: string | null; business_name: string | null;
}
interface LegTotals { cash: number; online: { method: string; amount: number }[]; financing: number; }
interface ReportData { totalSales: number; totalCount: number; byMethod: MethodRow[]; sales: MethodSale[]; byLeg: LegTotals; }

type SortKey = 'id' | 'created_at' | 'business_name' | 'cashier_name' | 'payment_method' | 'total';
const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: 'id', label: 'Sale #' },
  { key: 'created_at', label: 'Date' },
  { key: 'business_name', label: 'Business' },
  { key: 'cashier_name', label: 'Cashier' },
  { key: 'payment_method', label: 'Payment Method' },
  { key: 'total', label: 'Total', numeric: true },
];

export default function PaymentMethodReportClient() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [cashiers, setCashiers] = useState<CashierOption[]>([]);
  const [preset, setPreset] = useState<DatePreset | null>('This Month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [businessId, setBusinessId] = useState('');
  const [cashierId, setCashierId] = useState('');

  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const { toast, showToast, clearToast } = useToast();

  const [isOwner, setIsOwner] = useState(false);
  const [mismatchCount, setMismatchCount] = useState(0);
  const [fixing, setFixing] = useState(false);

  const range = preset ? resolvePresetRange(preset, customFrom, customTo) : null;

  const buildQuery = useCallback(() => {
    const params = new URLSearchParams();
    if (range) { params.set('from', range.from); params.set('to', range.to); }
    if (businessId) params.set('business_id', businessId);
    if (cashierId) params.set('cashier_id', cashierId);
    return params;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, customFrom, customTo, businessId, cashierId]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const d = await fetch(`/api/pos/reports/payment-methods?${buildQuery().toString()}`).then(r => r.json());
    setData(d);
    setPage(1);
    setLoading(false);
  }, [buildQuery]);

  // Owner-only: sales whose payment_method is missing a "<Provider> Financing"
  // mention even though financing_provider is set (see
  // app/api/pos/reports/payment-methods/fix-financing/route.ts) — a bug in
  // the checkout route, fixed for new sales going forward, but old sales in
  // whatever range is currently on screen may still need a one-time correction.
  const fetchMismatchCount = useCallback(async () => {
    if (!isOwner) return;
    const d = await fetch(`/api/pos/reports/payment-methods/fix-financing?${buildQuery().toString()}`).then(r => r.json());
    setMismatchCount(Array.isArray(d.mismatched) ? d.mismatched.length : 0);
  }, [buildQuery, isOwner]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { fetchMismatchCount(); }, [fetchMismatchCount]);
  useEffect(() => {
    fetch('/api/businesses').then(r => r.json()).then(d => setBusinesses(d.rows ?? []));
    fetch('/api/pos/reports/cashiers').then(r => r.json()).then(d => setCashiers((d.rows ?? []).filter((c: CashierOption) => c.cashier_id)));
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(u => setIsOwner(u?.role === 'owner'));
  }, []);

  const runFix = async () => {
    setFixing(true);
    try {
      const res = await fetch(`/api/pos/reports/payment-methods/fix-financing?${buildQuery().toString()}`, { method: 'POST' });
      const d = await res.json();
      if (!res.ok) { showToast(d.error || 'Failed to fix labels', 'error'); return; }
      showToast(`Fixed ${d.updated} sale${d.updated === 1 ? '' : 's'}!`);
      await fetchData();
      await fetchMismatchCount();
    } finally {
      setFixing(false);
    }
  };

  const sortedSales = useMemo(() => {
    const rows = data?.sales ?? [];
    return [...rows].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av ?? '').localeCompare(String(bv ?? ''));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedSales.length / pageSize));
  const paged = sortedSales.slice((page - 1) * pageSize, page * pageSize);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) { setSortDir(d => (d === 'asc' ? 'desc' : 'asc')); }
    else { setSortKey(key); setSortDir('desc'); }
  };

  const cellValue = (s: MethodSale, key: SortKey) => {
    switch (key) {
      case 'id': return `#${String(s.id).padStart(6, '0')}`;
      case 'created_at': return formatDate(s.created_at);
      case 'business_name': return s.business_name || '—';
      case 'cashier_name': return s.cashier_name || '—';
      case 'payment_method': return s.payment_method || '—';
      case 'total': return formatCurrency(s.total);
    }
  };

  const doPrint = () => window.print();

  const doCopy = async () => {
    const headerLine = COLUMNS.map(c => c.label).join('\t');
    const bodyLines = sortedSales.map(s => COLUMNS.map(c => cellValue(s, c.key)).join('\t'));
    try {
      await navigator.clipboard.writeText([headerLine, ...bodyLines].join('\n'));
      showToast('Copied to clipboard');
    } catch {
      showToast('Failed to copy', 'error');
    }
  };

  const doExcel = () => { window.location.href = `/api/pos/reports/payment-methods/export?${buildQuery().toString()}`; };

  const doCsv = () => {
    const headerLine = COLUMNS.map(c => c.label);
    const bodyRows = sortedSales.map(s => COLUMNS.map(c => cellValue(s, c.key)));
    const csv = [headerLine, ...bodyRows].map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'pos-payment-method-report.csv';
    a.click();
  };

  return (
    <div className="p-6 space-y-4">
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}

      <div className="flex items-center gap-3 print:hidden">
        <Link href="/pos/reports" className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"><ArrowLeft size={18} /></Link>
        <h1 className="text-xl font-bold text-gray-900">Payment Method Report</h1>
      </div>

      <div className="card space-y-3 print:hidden">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-[11px] text-gray-500 font-medium block mb-1">Business</label>
            <select className="form-input py-1.5 text-sm w-40" value={businessId} onChange={e => setBusinessId(e.target.value)}>
              <option value="">All Businesses</option>
              {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] text-gray-500 font-medium block mb-1">Cashier</label>
            <select className="form-input py-1.5 text-sm w-40" value={cashierId} onChange={e => setCashierId(e.target.value)}>
              <option value="">All Cashiers</option>
              {cashiers.map(c => <option key={c.cashier_id} value={c.cashier_id ?? ''}>{c.cashier_name || '—'}</option>)}
            </select>
          </div>
        </div>
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
      </div>

      {isOwner && mismatchCount > 0 && (
        <div className="card flex items-center justify-between gap-3 border-2 border-amber-200 bg-amber-50 print:hidden">
          <div className="flex items-center gap-2.5">
            <Wrench className="text-amber-600 shrink-0" size={18} />
            <p className="text-sm text-amber-800">
              <strong>{mismatchCount} sale{mismatchCount === 1 ? '' : 's'}</strong> in this range {mismatchCount === 1 ? 'has' : 'have'} an incomplete payment label
              (financing was used but not reflected — e.g. shows just &quot;Cash&quot; instead of &quot;Cash + Salmon Financing&quot;).
            </p>
          </div>
          <button onClick={runFix} disabled={fixing} className="btn-primary text-xs py-1.5 shrink-0 disabled:opacity-50">
            {fixing ? <Loader2 size={13} className="animate-spin" /> : <Wrench size={13} />}
            {fixing ? 'Fixing...' : 'Fix Now'}
          </button>
        </div>
      )}

      {loading || !data ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div className="card">
              <p className="text-xs text-gray-500">Net Sales</p>
              <p className="text-xl font-bold text-gray-900 tabular-nums mt-1">{formatCurrency(data.totalSales)}</p>
            </div>
            <div className="card">
              <p className="text-xs text-gray-500">Total Transactions</p>
              <p className="text-xl font-bold text-gray-900 tabular-nums mt-1">{data.totalCount}</p>
            </div>
          </div>

          {data.byLeg && (
            <div className="card">
              <h2 className="text-base font-semibold text-gray-900">Actual Cash / Online / Financing</h2>
              <p className="text-xs text-gray-500 mt-0.5 mb-4">
                A Cash + Financing sale is split into its actual legs here, so this matches the Cashier&apos;s Report&apos;s Payment Breakdown
                exactly — unlike the table below, which shows each sale&apos;s full value under its combined label instead.
              </p>
              <div className="flex flex-wrap gap-4">
                <div className="bg-gray-50 rounded-xl px-4 py-3 min-w-[120px]">
                  <p className="text-xs text-gray-500">Cash</p>
                  <p className="text-lg font-bold text-gray-900 tabular-nums mt-0.5">{formatCurrency(data.byLeg.cash)}</p>
                </div>
                {data.byLeg.online.map(o => (
                  <div key={o.method} className="bg-gray-50 rounded-xl px-4 py-3 min-w-[120px]">
                    <p className="text-xs text-gray-500">{o.method}</p>
                    <p className="text-lg font-bold text-gray-900 tabular-nums mt-0.5">{formatCurrency(o.amount)}</p>
                  </div>
                ))}
                {data.byLeg.financing > 0 && (
                  <div className="bg-amber-50 rounded-xl px-4 py-3 min-w-[120px]">
                    <p className="text-xs text-amber-700">Financing</p>
                    <p className="text-lg font-bold text-amber-800 tabular-nums mt-0.5">{formatCurrency(data.byLeg.financing)}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="card">
            <h2 className="text-base font-semibold text-gray-900 mb-4">By Payment Method</h2>
            {data.byMethod.length === 0 ? (
              <p className="text-center text-gray-400 text-sm py-8">No sales in this range.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    {['Payment Method', 'Transactions', 'Total', '% of Total'].map(h => <th key={h} className="table-header">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {data.byMethod.map((m, i) => (
                    <tr key={m.payment_method} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="table-cell font-medium">{m.payment_method}</td>
                      <td className="table-cell tabular-nums">{m.count}</td>
                      <td className="table-cell font-semibold tabular-nums">{formatCurrency(m.total)}</td>
                      <td className="table-cell tabular-nums text-gray-500">
                        {data.totalSales > 0 ? ((m.total / data.totalSales) * 100).toFixed(1) : '0.0'}%
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200">
                    <td className="table-cell font-bold">TOTAL</td>
                    <td className="table-cell font-bold tabular-nums">{data.totalCount}</td>
                    <td className="table-cell font-bold tabular-nums">{formatCurrency(data.totalSales)}</td>
                    <td className="table-cell font-bold tabular-nums text-gray-500">100.0%</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>

          <div className="card">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4 print:hidden">
              <div className="flex items-center gap-2">
                <button onClick={doPrint} className="btn-secondary text-xs py-1.5"><Printer size={13} /> Print</button>
                <button onClick={doCopy} className="btn-secondary text-xs py-1.5"><Copy size={13} /> Copy</button>
                <button onClick={doExcel} className="btn-secondary text-xs py-1.5"><FileSpreadsheet size={13} /> Excel</button>
                <button onClick={doCsv} className="btn-secondary text-xs py-1.5"><Download size={13} /> CSV</button>
              </div>
            </div>

            {sortedSales.length === 0 ? (
              <p className="text-center text-gray-400 text-sm py-12">No sales match these filters.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      {COLUMNS.map(c => (
                        <th key={c.key} className="table-header cursor-pointer select-none hover:text-gray-700" onClick={() => toggleSort(c.key)}>
                          <span className="inline-flex items-center gap-1 whitespace-nowrap">{c.label} <ArrowUpDown size={11} className={sortKey === c.key ? 'text-orange-500' : 'text-gray-300'} /></span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {paged.map((s, i) => (
                      <tr key={s.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="table-cell font-medium tabular-nums">#{String(s.id).padStart(6, '0')}</td>
                        <td className="table-cell text-gray-500 whitespace-nowrap">{formatDate(s.created_at)}</td>
                        <td className="table-cell">{s.business_name || '—'}</td>
                        <td className="table-cell">{s.cashier_name || '—'}</td>
                        <td className="table-cell">{s.payment_method || '—'}</td>
                        <td className="table-cell font-semibold tabular-nums">{formatCurrency(s.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100 print:hidden">
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <span>Show</span>
                    <select className="form-input py-1 text-xs w-16" value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}>
                      {[10, 25, 50].map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                    <span>entries — showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, sortedSales.length)} of {sortedSales.length}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-40"><ChevronLeft size={16} /></button>
                    <span className="text-sm px-2">{page} / {totalPages}</span>
                    <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-40"><ChevronRight size={16} /></button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
