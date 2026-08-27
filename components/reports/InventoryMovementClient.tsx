'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Printer, Copy, FileSpreadsheet, Download, Search, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatCurrency, todayISO } from '@/lib/utils';
import Spinner from '@/components/ui/Spinner';
import { Toast, useToast } from '@/components/ui/Toast';

interface Row {
  product_id: number; sku: string; name: string; category: string | null; cogs: number;
  beginning_qty: number; stock_in: number; stock_out: number; ending_qty: number;
  beginning_value: number; ending_value: number;
}

type SortKey = 'name' | 'category' | 'beginning_qty' | 'stock_in' | 'stock_out' | 'ending_qty' | 'beginning_value' | 'ending_value';
const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: 'name', label: 'Product' },
  { key: 'category', label: 'Category' },
  { key: 'beginning_qty', label: 'Beginning Qty', numeric: true },
  { key: 'stock_in', label: 'Stock In', numeric: true },
  { key: 'stock_out', label: 'Stock Out', numeric: true },
  { key: 'ending_qty', label: 'Ending Qty', numeric: true },
  { key: 'beginning_value', label: 'Beginning Value', numeric: true },
  { key: 'ending_value', label: 'Ending Value', numeric: true },
];

const monthStart = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; };

export default function InventoryMovementClient() {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayISO());
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const { toast, showToast, clearToast } = useToast();

  const buildQuery = useCallback(() => {
    const params = new URLSearchParams();
    params.set('from', from); params.set('to', to);
    return params;
  }, [from, to]);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const data = await fetch(`/api/reports/inventory-movement?${buildQuery().toString()}`).then(r => r.json());
    setRows(data.rows ?? []);
    setPage(1);
    setLoading(false);
  }, [buildQuery]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let result = rows;
    if (q) result = result.filter(r => r.name.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q) || (r.category ?? '').toLowerCase().includes(q));
    result = [...result].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av ?? '').localeCompare(String(bv ?? ''));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return result;
  }, [rows, search, sortKey, sortDir]);

  const totals = useMemo(() => filteredRows.reduce((acc, r) => ({
    beginning_qty: acc.beginning_qty + r.beginning_qty, stock_in: acc.stock_in + r.stock_in,
    stock_out: acc.stock_out + r.stock_out, ending_qty: acc.ending_qty + r.ending_qty,
    beginning_value: acc.beginning_value + r.beginning_value, ending_value: acc.ending_value + r.ending_value,
  }), { beginning_qty: 0, stock_in: 0, stock_out: 0, ending_qty: 0, beginning_value: 0, ending_value: 0 }), [filteredRows]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const paged = filteredRows.slice((page - 1) * pageSize, page * pageSize);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) { setSortDir(d => (d === 'asc' ? 'desc' : 'asc')); }
    else { setSortKey(key); setSortDir(key === 'name' || key === 'category' ? 'asc' : 'desc'); }
  };

  const doPrint = () => window.print();

  const doCopy = async () => {
    const headerLine = COLUMNS.map(c => c.label).join('\t');
    const bodyLines = filteredRows.map(r => COLUMNS.map(c => {
      const v = r[c.key];
      return c.numeric ? (c.key.includes('value') ? formatCurrency(Number(v)) : v) : v;
    }).join('\t'));
    try {
      await navigator.clipboard.writeText([headerLine, ...bodyLines].join('\n'));
      showToast('Copied to clipboard');
    } catch {
      showToast('Failed to copy', 'error');
    }
  };

  const doExcel = () => { window.location.href = `/api/reports/inventory-movement/export?${buildQuery().toString()}`; };

  const doCsv = () => {
    const headerLine = COLUMNS.map(c => c.label);
    const bodyRows = filteredRows.map(r => COLUMNS.map(c => r[c.key] ?? ''));
    const csv = [headerLine, ...bodyRows].map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'beginning-ending-inventory-report.csv';
    a.click();
  };

  return (
    <div className="p-6 space-y-4">
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}

      <div className="flex items-center gap-3 print:hidden">
        <Link href="/reports" className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"><ArrowLeft size={18} /></Link>
        <h1 className="text-xl font-bold text-gray-900">Beginning &amp; Ending Inventory Report</h1>
      </div>

      <div className="card space-y-3 print:hidden">
        <div className="flex items-center gap-3 flex-wrap">
          <div>
            <label className="text-[11px] text-gray-500 font-medium block mb-1">From</label>
            <input type="date" className="form-input py-1.5 text-sm w-auto" value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="text-[11px] text-gray-500 font-medium block mb-1">To</label>
            <input type="date" className="form-input py-1.5 text-sm w-auto" value={to} onChange={e => setTo(e.target.value)} />
          </div>
        </div>
        <p className="text-xs text-gray-400">products/inventory are shared across all businesses — no per-business filter applies here.</p>
      </div>

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4 print:hidden">
          <div className="flex items-center gap-2">
            <button onClick={doPrint} className="btn-secondary text-xs py-1.5"><Printer size={13} /> Print</button>
            <button onClick={doCopy} className="btn-secondary text-xs py-1.5"><Copy size={13} /> Copy</button>
            <button onClick={doExcel} className="btn-secondary text-xs py-1.5"><FileSpreadsheet size={13} /> Excel</button>
            <button onClick={doCsv} className="btn-secondary text-xs py-1.5"><Download size={13} /> CSV</button>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-300" />
            <input className="form-input py-1.5 text-sm pl-8 w-56" placeholder="Search product, SKU, category"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : filteredRows.length === 0 ? (
          <p className="text-center text-gray-400 text-sm py-12">No products found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="table-header">SKU</th>
                  {COLUMNS.map(c => (
                    <th key={c.key} className="table-header cursor-pointer select-none hover:text-gray-700" onClick={() => toggleSort(c.key)}>
                      <span className="inline-flex items-center gap-1 whitespace-nowrap">{c.label} <ArrowUpDown size={11} className={sortKey === c.key ? 'text-orange-500' : 'text-gray-300'} /></span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paged.map((r, i) => (
                  <tr key={r.product_id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="table-cell font-mono text-xs font-semibold text-gray-600">{r.sku}</td>
                    <td className="table-cell font-medium">{r.name}</td>
                    <td className="table-cell text-gray-500">{r.category || '—'}</td>
                    <td className="table-cell tabular-nums">{r.beginning_qty}</td>
                    <td className="table-cell tabular-nums text-emerald-600">{r.stock_in > 0 ? `+${r.stock_in}` : 0}</td>
                    <td className="table-cell tabular-nums text-red-500">{r.stock_out > 0 ? `-${r.stock_out}` : 0}</td>
                    <td className="table-cell font-semibold tabular-nums">{r.ending_qty}</td>
                    <td className="table-cell tabular-nums">{formatCurrency(r.beginning_value)}</td>
                    <td className="table-cell font-semibold tabular-nums">{formatCurrency(r.ending_value)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 font-bold">
                  <td className="table-cell" colSpan={2}>TOTAL</td>
                  <td className="table-cell"></td>
                  <td className="table-cell tabular-nums">{totals.beginning_qty}</td>
                  <td className="table-cell tabular-nums text-emerald-600">+{totals.stock_in}</td>
                  <td className="table-cell tabular-nums text-red-500">-{totals.stock_out}</td>
                  <td className="table-cell tabular-nums">{totals.ending_qty}</td>
                  <td className="table-cell tabular-nums">{formatCurrency(totals.beginning_value)}</td>
                  <td className="table-cell tabular-nums">{formatCurrency(totals.ending_value)}</td>
                </tr>
              </tfoot>
            </table>

            <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100 print:hidden">
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span>Show</span>
                <select className="form-input py-1 text-xs w-16" value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}>
                  {[10, 25, 50].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
                <span>entries — showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filteredRows.length)} of {filteredRows.length}</span>
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
    </div>
  );
}
