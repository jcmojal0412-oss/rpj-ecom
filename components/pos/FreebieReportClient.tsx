'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Printer, Copy, FileSpreadsheet, Download, ArrowUpDown, ChevronLeft, ChevronRight, Gift } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import Spinner from '@/components/ui/Spinner';
import { Toast, useToast } from '@/components/ui/Toast';
import { DATE_PRESETS, resolvePresetRange, type DatePreset } from '@/components/expenses/dateRanges';
import type { Business } from './constants';

interface CashierOption { cashier_id: number | null; cashier_name: string | null; }
interface FreebieItem {
  item_id: number; sale_id: number; receipt_no: string | null; created_at: string;
  business_name: string | null; cashier_name: string | null;
  product_name: string; sku: string | null; quantity: number; original_price: number;
  value: number; freebie_reason: string | null;
}
interface FreebieData {
  totalValue: number; freebieCount: number; avgValue: number;
  byCashier: { cashier_id: number | null; cashier_name: string | null; count: number; total_value: number }[];
  byProduct: { product_id: number | null; product_name: string; sku: string | null; count: number; total_qty: number; total_value: number }[];
  items: FreebieItem[];
}

type SortKey = 'sale_id' | 'created_at' | 'cashier_name' | 'product_name' | 'quantity' | 'value' | 'freebie_reason';
const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: 'sale_id', label: 'Sale #' },
  { key: 'created_at', label: 'Date' },
  { key: 'cashier_name', label: 'Cashier' },
  { key: 'product_name', label: 'Product' },
  { key: 'quantity', label: 'Qty', numeric: true },
  { key: 'value', label: 'Cost Given Away', numeric: true },
  { key: 'freebie_reason', label: 'Reason' },
];

export default function FreebieReportClient() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [cashiers, setCashiers] = useState<CashierOption[]>([]);
  const [preset, setPreset] = useState<DatePreset | null>('This Month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [businessId, setBusinessId] = useState('');
  const [cashierId, setCashierId] = useState('');

  const [data, setData] = useState<FreebieData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const { toast, showToast, clearToast } = useToast();

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
    const d = await fetch(`/api/pos/reports/freebies?${buildQuery().toString()}`).then(r => r.json());
    setData(d);
    setPage(1);
    setLoading(false);
  }, [buildQuery]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    fetch('/api/businesses').then(r => r.json()).then(d => setBusinesses(d.rows ?? []));
    fetch('/api/pos/reports/cashiers').then(r => r.json()).then(d => setCashiers((d.rows ?? []).filter((c: CashierOption) => c.cashier_id)));
  }, []);

  const sortedItems = useMemo(() => {
    const rows = data?.items ?? [];
    return [...rows].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av ?? '').localeCompare(String(bv ?? ''));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedItems.length / pageSize));
  const paged = sortedItems.slice((page - 1) * pageSize, page * pageSize);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) { setSortDir(d => (d === 'asc' ? 'desc' : 'asc')); }
    else { setSortKey(key); setSortDir('desc'); }
  };

  const cellValue = (it: FreebieItem, key: SortKey) => {
    switch (key) {
      case 'sale_id': return it.receipt_no ? `#${it.receipt_no}` : `#${String(it.sale_id).padStart(6, '0')}`;
      case 'created_at': return formatDate(it.created_at);
      case 'cashier_name': return it.cashier_name || '—';
      case 'product_name': return it.product_name;
      case 'quantity': return it.quantity;
      case 'value': return formatCurrency(it.value);
      case 'freebie_reason': return it.freebie_reason || '—';
    }
  };

  const doPrint = () => window.print();

  const doCopy = async () => {
    const headerLine = COLUMNS.map(c => c.label).join('\t');
    const bodyLines = sortedItems.map(it => COLUMNS.map(c => cellValue(it, c.key)).join('\t'));
    try {
      await navigator.clipboard.writeText([headerLine, ...bodyLines].join('\n'));
      showToast('Copied to clipboard');
    } catch {
      showToast('Failed to copy', 'error');
    }
  };

  const doCsv = () => {
    const headerLine = COLUMNS.map(c => c.label);
    const bodyRows = sortedItems.map(it => COLUMNS.map(c => cellValue(it, c.key)));
    const csv = [headerLine, ...bodyRows].map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'pos-freebie-report.csv';
    a.click();
  };

  return (
    <div className="p-6 space-y-4">
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}

      <div className="flex items-center gap-3 print:hidden">
        <Link href="/pos/reports" className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"><ArrowLeft size={18} /></Link>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Freebies Report</h1>
          <p className="text-xs text-gray-400">Every item given away for free, with the cashier who processed it — for spotting unusual patterns before they add up.</p>
        </div>
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

      {loading || !data ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="card">
              <p className="text-xs text-gray-500 flex items-center gap-1"><Gift size={13} /> Total Cost Given Away</p>
              <p className="text-xl font-bold text-amber-600 tabular-nums mt-1">{formatCurrency(data.totalValue)}</p>
            </div>
            <div className="card">
              <p className="text-xs text-gray-500">Freebies Given</p>
              <p className="text-xl font-bold text-gray-900 tabular-nums mt-1">{data.freebieCount}</p>
            </div>
            <div className="card">
              <p className="text-xs text-gray-500">Average Cost per Freebie</p>
              <p className="text-xl font-bold text-gray-900 tabular-nums mt-1">{formatCurrency(data.avgValue)}</p>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <div className="card">
              <h2 className="text-base font-semibold text-gray-900 mb-4">By Cashier</h2>
              {data.byCashier.length === 0 ? (
                <p className="text-center text-gray-400 text-sm py-8">No freebies given in this range.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      {['Cashier', 'Freebies Given', 'Total Cost'].map(h => <th key={h} className="table-header">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {data.byCashier.map((c, i) => (
                      <tr key={c.cashier_id ?? i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="table-cell font-medium">{c.cashier_name || '—'}</td>
                        <td className="table-cell tabular-nums">{c.count}</td>
                        <td className="table-cell font-semibold tabular-nums text-amber-600">{formatCurrency(c.total_value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="card">
              <h2 className="text-base font-semibold text-gray-900 mb-4">Top 5 Freebies Product</h2>
              {data.byProduct.length === 0 ? (
                <p className="text-center text-gray-400 text-sm py-8">No freebies given in this range.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      {['Product', 'Times Given', 'Qty', 'Total Cost'].map(h => <th key={h} className="table-header">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {data.byProduct.map((p, i) => (
                      <tr key={p.product_id ?? i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="table-cell font-medium">{p.product_name}{p.sku ? <span className="text-gray-400 font-mono text-xs ml-1.5">{p.sku}</span> : null}</td>
                        <td className="table-cell tabular-nums">{p.count}</td>
                        <td className="table-cell tabular-nums">{p.total_qty}</td>
                        <td className="table-cell font-semibold tabular-nums text-amber-600">{formatCurrency(p.total_value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="card">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4 print:hidden">
              <div className="flex items-center gap-2">
                <button onClick={doPrint} className="btn-secondary text-xs py-1.5"><Printer size={13} /> Print</button>
                <button onClick={doCopy} className="btn-secondary text-xs py-1.5"><Copy size={13} /> Copy</button>
                <button onClick={doCsv} className="btn-secondary text-xs py-1.5"><Download size={13} /> CSV</button>
              </div>
            </div>

            {sortedItems.length === 0 ? (
              <p className="text-center text-gray-400 text-sm py-12">No freebies match these filters.</p>
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
                    {paged.map((it, i) => (
                      <tr key={it.item_id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="table-cell font-medium tabular-nums whitespace-nowrap">{it.receipt_no ? `#${it.receipt_no}` : `#${String(it.sale_id).padStart(6, '0')}`}</td>
                        <td className="table-cell text-gray-500 whitespace-nowrap">{formatDate(it.created_at)}</td>
                        <td className="table-cell">{it.cashier_name || '—'}</td>
                        <td className="table-cell font-medium">{it.product_name}{it.sku ? <span className="text-gray-400 font-mono text-xs ml-1.5">{it.sku}</span> : null}</td>
                        <td className="table-cell tabular-nums">{it.quantity}</td>
                        <td className="table-cell font-semibold tabular-nums text-amber-600">{formatCurrency(it.value)}</td>
                        <td className="table-cell text-gray-500">{it.freebie_reason || '—'}</td>
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
                    <span>entries — showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, sortedItems.length)} of {sortedItems.length}</span>
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
