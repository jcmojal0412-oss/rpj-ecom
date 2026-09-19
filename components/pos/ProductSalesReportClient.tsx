'use client';

import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from 'react';
import Link from 'next/link';
import { ArrowLeft, Printer, Copy, FileSpreadsheet, Download, Search, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import Spinner from '@/components/ui/Spinner';
import { Toast, useToast } from '@/components/ui/Toast';
import { DATE_PRESETS, resolvePresetRange, type DatePreset } from '@/components/expenses/dateRanges';
import type { Business, Product, ProductSalesRow } from './constants';

interface CashierOption { cashier_id: number | null; cashier_name: string | null; }
interface DailyRow { date: string; product_id: number; product_name: string; sku: string | null; category: string | null; qty_sold: number; }

type SortKey = keyof Pick<ProductSalesRow, 'product_name' | 'category' | 'qty_sold' | 'unit_cost' | 'total_cost' | 'unit_price' | 'total_sales' | 'total_discount' | 'profit'>;

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: 'product_name', label: 'Product' },
  { key: 'category', label: 'Category' },
  { key: 'qty_sold', label: 'Qty Sold', numeric: true },
  { key: 'unit_cost', label: 'Unit Cost', numeric: true },
  { key: 'total_cost', label: 'Total Cost of Goods', numeric: true },
  { key: 'unit_price', label: 'Selling Price', numeric: true },
  { key: 'total_sales', label: 'Total Sales', numeric: true },
  { key: 'total_discount', label: 'Total Discount', numeric: true },
  { key: 'profit', label: 'Profit', numeric: true },
];

export default function ProductSalesReportClient() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [preset, setPreset] = useState<DatePreset | null>('This Month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [businessId, setBusinessId] = useState('');
  const [productId, setProductId] = useState('');
  const [category, setCategory] = useState('');
  const [cashierId, setCashierId] = useState('');
  const [cashiers, setCashiers] = useState<CashierOption[]>([]);

  const [rows, setRows] = useState<ProductSalesRow[]>([]);
  const [grossSales, setGrossSales] = useState<number | null>(null);
  const [dailyRows, setDailyRows] = useState<DailyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('qty_sold');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const { toast, showToast, clearToast } = useToast();

  const range = preset ? resolvePresetRange(preset, customFrom, customTo) : null;

  const buildQuery = useCallback(() => {
    const params = new URLSearchParams();
    if (range) { params.set('from', range.from); params.set('to', range.to); }
    if (businessId) params.set('business_id', businessId);
    if (productId) params.set('product_id', productId);
    if (category) params.set('category', category);
    if (cashierId) params.set('cashier_id', cashierId);
    return params;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, customFrom, customTo, businessId, productId, category, cashierId]);

  // Guards against a race between quick filter changes — see
  // DiscountReportClient.tsx for the full explanation.
  const fetchTicket = useRef(0);
  const fetchRows = useCallback(async () => {
    const ticket = ++fetchTicket.current;
    setLoading(true);
    // grossSales rides along on the same request/query as the product rows
    // (date + business scope only, same as Gross Sales elsewhere) — no
    // second round-trip, no duplicating the pos_sale_items scan the detail
    // query already does.
    const data = await fetch(`/api/pos/reports/products/detail?${buildQuery().toString()}`).then(r => r.json());
    if (ticket !== fetchTicket.current) return;
    setRows(data.rows ?? []);
    setGrossSales(typeof data.grossSales === 'number' ? data.grossSales : null);
    setPage(1);
    // Day-by-day units only makes sense once narrowed to a category or a
    // single product — across the whole catalog it'd just be a huge,
    // unreadable date x product grid.
    if (category || productId) {
      const daily = await fetch(`/api/pos/reports/products/daily?${buildQuery().toString()}`).then(r => r.json());
      if (ticket !== fetchTicket.current) return;
      setDailyRows(daily.rows ?? []);
    } else {
      setDailyRows([]);
    }
    setLoading(false);
  }, [buildQuery, category, productId]);

  useEffect(() => { fetchRows(); }, [fetchRows]);
  useEffect(() => {
    fetch('/api/businesses').then(r => r.json()).then(d => setBusinesses(d.rows ?? []));
    fetch('/api/pos/products').then(r => r.json()).then(d => setProducts(d.rows ?? []));
    fetch('/api/pos/reports/cashiers').then(r => r.json()).then(d => setCashiers((d.rows ?? []).filter((c: CashierOption) => c.cashier_id)));
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach(p => { if (p.category) set.add(p.category); });
    return [...set].sort();
  }, [products]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let result = rows;
    if (q) result = result.filter(r => r.product_name.toLowerCase().includes(q) || (r.category ?? '').toLowerCase().includes(q));
    result = [...result].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av ?? '').localeCompare(String(bv ?? ''));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return result;
  }, [rows, search, sortKey, sortDir]);

  const totals = useMemo(() => filteredRows.reduce((acc, r) => ({
    qty_sold: acc.qty_sold + r.qty_sold,
    total_cost: acc.total_cost + r.total_cost,
    total_sales: acc.total_sales + r.total_sales,
    total_discount: acc.total_discount + r.total_discount,
    profit: acc.profit + r.profit,
  }), { qty_sold: 0, total_cost: 0, total_sales: 0, total_discount: 0, profit: 0 }), [filteredRows]);

  const dailyGroups = useMemo(() => {
    const byDate = new Map<string, { date: string; items: DailyRow[]; dayTotal: number }>();
    for (const r of dailyRows) {
      const g = byDate.get(r.date) ?? { date: r.date, items: [], dayTotal: 0 };
      g.items.push(r);
      g.dayTotal += r.qty_sold;
      byDate.set(r.date, g);
    }
    return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
  }, [dailyRows]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const paged = filteredRows.slice((page - 1) * pageSize, page * pageSize);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) { setSortDir(d => (d === 'asc' ? 'desc' : 'asc')); }
    else { setSortKey(key); setSortDir('desc'); }
  };

  const doPrint = () => window.print();

  const doCopy = async () => {
    const headerLine = COLUMNS.map(c => c.label).join('\t');
    const bodyLines = filteredRows.map(r => COLUMNS.map(c => {
      const v = r[c.key];
      return c.numeric ? formatCurrency(Number(v)) : (v ?? '');
    }).join('\t'));
    try {
      await navigator.clipboard.writeText([headerLine, ...bodyLines].join('\n'));
      showToast('Copied to clipboard');
    } catch {
      showToast('Failed to copy', 'error');
    }
  };

  const doExcel = () => { window.location.href = `/api/pos/reports/products/export?${buildQuery().toString()}`; };

  const doCsv = () => {
    const headerLine = COLUMNS.map(c => c.label);
    const bodyRows = filteredRows.map(r => COLUMNS.map(c => r[c.key] ?? ''));
    const csv = [headerLine, ...bodyRows].map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'product-sales-report.csv';
    a.click();
  };

  return (
    <div className="p-3 sm:p-4 lg:p-6 space-y-4">
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}

      <div className="flex items-center gap-3 print:hidden">
        <Link href="/pos/reports" className="p-2.5 lg:p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"><ArrowLeft size={18} /></Link>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Product Sales Report</h1>
          <p className="text-xs text-gray-400">Figures are net of refunds/exchanges — a returned unit no longer counts toward Qty Sold, Total Sales, or Total Cost of Goods (cost stays out only when the return was restocked; a Defective return keeps its cost). Product-only — Service/Reservation Fee lines aren't tied to a product, so they're excluded here; that's why this page's Total Sales runs lower than Gross Sales on the summary page.</p>
        </div>
      </div>

      <div className="card p-4 sm:p-6 space-y-3 print:hidden">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-auto">
            <label className="text-[11px] text-gray-500 font-medium block mb-1">Product</label>
            <select className="form-input py-2 sm:py-1.5 text-sm w-full sm:w-48" value={productId} onChange={e => setProductId(e.target.value)}>
              <option value="">Select Product</option>
              {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="w-full sm:w-auto">
            <label className="text-[11px] text-gray-500 font-medium block mb-1">Product Category</label>
            <select className="form-input py-2 sm:py-1.5 text-sm w-full sm:w-48" value={category} onChange={e => setCategory(e.target.value)}>
              <option value="">Select Product Category</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="w-full sm:w-auto">
            <label className="text-[11px] text-gray-500 font-medium block mb-1">Business</label>
            <select className="form-input py-2 sm:py-1.5 text-sm w-full sm:w-40" value={businessId} onChange={e => setBusinessId(e.target.value)}>
              <option value="">All Businesses</option>
              {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div className="w-full sm:w-auto">
            <label className="text-[11px] text-gray-500 font-medium block mb-1">Cashier</label>
            <select className="form-input py-2 sm:py-1.5 text-sm w-full sm:w-40" value={cashierId} onChange={e => setCashierId(e.target.value)}>
              <option value="">All Cashiers</option>
              {cashiers.map(c => <option key={c.cashier_id} value={c.cashier_id ?? ''}>{c.cashier_name || '—'}</option>)}
            </select>
          </div>
        </div>

        <div className="flex items-center bg-gray-100 rounded-lg p-1 gap-0.5 max-w-full overflow-x-auto sm:w-fit sm:flex-wrap">
          <button onClick={() => setPreset(null)}
            className={`shrink-0 whitespace-nowrap px-3 py-2 sm:py-1.5 rounded-md text-xs font-semibold transition-all ${!preset ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            All Dates
          </button>
          {DATE_PRESETS.map(p => (
            <button key={p} onClick={() => setPreset(p)}
              className={`shrink-0 px-3 py-2 sm:py-1.5 rounded-md text-xs font-semibold transition-all whitespace-nowrap ${preset === p ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {p}
            </button>
          ))}
        </div>
        {preset === 'Custom' && (
          <div className="flex items-center gap-3 flex-wrap">
            <input type="date" className="form-input py-2 sm:py-1.5 text-sm w-auto" value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
            <span className="text-gray-400 text-sm">—</span>
            <input type="date" className="form-input py-2 sm:py-1.5 text-sm w-auto" value={customTo} onChange={e => setCustomTo(e.target.value)} />
          </div>
        )}
      </div>

      <div className="card p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4 print:hidden">
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={doPrint} className="btn-secondary text-xs py-2.5 sm:py-1.5"><Printer size={13} /> Print</button>
            <button onClick={doCopy} className="btn-secondary text-xs py-2.5 sm:py-1.5"><Copy size={13} /> Copy</button>
            <button onClick={doExcel} className="btn-secondary text-xs py-2.5 sm:py-1.5"><FileSpreadsheet size={13} /> Excel</button>
            <button onClick={doCsv} className="btn-secondary text-xs py-2.5 sm:py-1.5"><Download size={13} /> CSV</button>
          </div>
          <div className="relative w-full sm:w-auto">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-300" />
            <input className="form-input py-2 sm:py-1.5 text-sm pl-8 w-full sm:w-56" placeholder="Search product or category"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : filteredRows.length === 0 ? (
          <p className="text-center text-gray-400 text-sm py-12">No sales match these filters.</p>
        ) : (
          <div className="overflow-x-auto">
            {/* Phone: the wide table can't fit, so rows become cards and sorting moves to a select. */}
                <div className="md:hidden flex items-center gap-2 mb-3 print:hidden">
                  <select className="form-input py-2 text-sm flex-1 min-w-0" value={sortKey} onChange={e => { if (e.target.value !== sortKey) toggleSort(e.target.value as SortKey); }} aria-label="Sort by">
                    {COLUMNS.map(c => <option key={c.key} value={c.key}>Sort: {c.label}</option>)}
                  </select>
                  <button onClick={() => setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))} className="btn-secondary text-xs py-2.5 shrink-0">
                    <ArrowUpDown size={13} /> {sortDir === 'asc' ? 'Asc' : 'Desc'}
                  </button>
                </div>
                <div className="md:hidden space-y-2.5">
                  {paged.map((r, i) => (
                    <div key={r.product_id} className="rounded-xl border border-gray-200 bg-white p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-gray-900"><span className="text-gray-400 font-normal mr-1.5">{(page - 1) * pageSize + i + 1}.</span>{r.product_name}</p>
                          <p className="text-xs text-gray-500">{r.category || '—'}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-base font-bold text-gray-900 tabular-nums">{formatCurrency(r.total_sales)}</p>
                          <p className={`text-xs font-semibold tabular-nums ${r.profit >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>Profit {formatCurrency(r.profit)}</p>
                        </div>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-gray-600">
                        <span>Qty sold <span className="font-medium text-gray-800 tabular-nums">{r.qty_sold}</span></span>
                        <span>Price <span className="font-medium text-gray-800 tabular-nums">{formatCurrency(r.unit_price)}</span></span>
                        <span>Unit cost <span className="font-medium text-gray-800 tabular-nums">{formatCurrency(r.unit_cost)}</span></span>
                        <span>Total cost <span className="font-medium text-gray-800 tabular-nums">{formatCurrency(r.total_cost)}</span></span>
                        {r.total_discount > 0 && <span>Discount <span className="font-medium text-gray-800 tabular-nums">{formatCurrency(r.total_discount)}</span></span>}
                      </div>
                    </div>
                  ))}
                  <div className="rounded-xl border-2 border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
                    <p className="text-sm font-bold text-gray-900 mb-1">TOTAL</p>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                      <span>Qty sold <span className="font-bold text-gray-900 tabular-nums">{totals.qty_sold}</span></span>
                      <span>Total cost <span className="font-bold text-gray-900 tabular-nums">{formatCurrency(totals.total_cost)}</span></span>
                      <span>Sales <span className="font-bold text-gray-900 tabular-nums">{formatCurrency(totals.total_sales)}</span></span>
                      <span>Discount <span className="font-bold text-gray-900 tabular-nums">{formatCurrency(totals.total_discount)}</span></span>
                      <span>Profit <span className="font-bold text-gray-900 tabular-nums">{formatCurrency(totals.profit)}</span></span>
                    </div>
                  </div>
                </div>

            <table className="w-full text-sm hidden md:table">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="table-header">#</th>
                  {COLUMNS.map(c => (
                    <th key={c.key} className="table-header cursor-pointer select-none hover:text-gray-700" onClick={() => toggleSort(c.key)}>
                      <span className="inline-flex items-center gap-1">{c.label} <ArrowUpDown size={11} className={sortKey === c.key ? 'text-orange-500' : 'text-gray-300'} /></span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paged.map((r, i) => (
                  <tr key={r.product_id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="table-cell text-gray-400">{(page - 1) * pageSize + i + 1}</td>
                    <td className="table-cell font-medium">{r.product_name}</td>
                    <td className="table-cell text-gray-500">{r.category || '—'}</td>
                    <td className="table-cell tabular-nums">{r.qty_sold}</td>
                    <td className="table-cell tabular-nums">{formatCurrency(r.unit_cost)}</td>
                    <td className="table-cell tabular-nums">{formatCurrency(r.total_cost)}</td>
                    <td className="table-cell tabular-nums">{formatCurrency(r.unit_price)}</td>
                    <td className="table-cell font-semibold tabular-nums">{formatCurrency(r.total_sales)}</td>
                    <td className="table-cell tabular-nums">{r.total_discount > 0 ? formatCurrency(r.total_discount) : '—'}</td>
                    <td className={`table-cell font-semibold tabular-nums ${r.profit >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{formatCurrency(r.profit)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 font-bold">
                  <td className="table-cell" colSpan={3}>TOTAL</td>
                  <td className="table-cell tabular-nums">{totals.qty_sold}</td>
                  <td className="table-cell"></td>
                  <td className="table-cell tabular-nums">{formatCurrency(totals.total_cost)}</td>
                  <td className="table-cell"></td>
                  <td className="table-cell tabular-nums">{formatCurrency(totals.total_sales)}</td>
                  <td className="table-cell tabular-nums">{formatCurrency(totals.total_discount)}</td>
                  <td className="table-cell tabular-nums">{formatCurrency(totals.profit)}</td>
                </tr>
              </tfoot>
            </table>

            {!productId && !category && !cashierId && !search && grossSales != null && grossSales - totals.total_sales > 0.005 && (
              <p className="text-xs text-gray-500 sm:text-right mt-2">
                + {formatCurrency(grossSales - totals.total_sales)} non-product (Service/Reservation Fees, etc.) = <span className="font-semibold text-gray-700">{formatCurrency(grossSales)}</span> Gross Sales
              </p>
            )}

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-4 pt-4 border-t border-gray-100 print:hidden">
              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                <span>Show</span>
                <select className="form-input py-1.5 sm:py-1 text-xs w-16" value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}>
                  {[10, 25, 50].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
                <span>entries — showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filteredRows.length)} of {filteredRows.length}</span>
              </div>
              <div className="flex items-center justify-center sm:justify-start gap-1">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="p-2.5 lg:p-1.5 rounded hover:bg-gray-100 disabled:opacity-40"><ChevronLeft size={16} /></button>
                <span className="text-sm px-2">{page} / {totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="p-2.5 lg:p-1.5 rounded hover:bg-gray-100 disabled:opacity-40"><ChevronRight size={16} /></button>
              </div>
            </div>
          </div>
        )}
      </div>

      {(category || productId) && (
        <div className="card p-4 sm:p-6 print:hidden">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">
            Daily Units Sold{category ? ` — ${category}` : ''}{productId ? ` — ${products.find(p => String(p.id) === productId)?.name ?? ''}` : ''}
          </h2>
          <p className="text-xs text-gray-400 mb-3">Net of refunds/exchanges, same filters as above.</p>
          {dailyGroups.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-8">No sales match these filters.</p>
          ) : (
            <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b border-gray-100">
                    <th className="table-header">Date</th>
                    <th className="table-header">Product</th>
                    <th className="table-header">SKU</th>
                    <th className="table-header text-right">Qty Sold</th>
                  </tr>
                </thead>
                <tbody>
                  {dailyGroups.map(g => (
                    <Fragment key={g.date}>
                      {g.items.map((r, idx) => (
                        <tr key={`${g.date}-${r.product_id}`} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                          <td className="table-cell text-gray-500">{idx === 0 ? formatDate(g.date) : ''}</td>
                          <td className="table-cell font-medium">{r.product_name}</td>
                          <td className="table-cell text-gray-400 font-mono text-xs">{r.sku || '—'}</td>
                          <td className="table-cell text-right tabular-nums">{r.qty_sold}</td>
                        </tr>
                      ))}
                      {g.items.length > 1 && (
                        <tr key={`${g.date}-total`} className="bg-gray-100 font-semibold">
                          <td className="table-cell" colSpan={3}>Day Total</td>
                          <td className="table-cell text-right tabular-nums">{g.dayTotal}</td>
                        </tr>
                      )}
                    </Fragment>
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
