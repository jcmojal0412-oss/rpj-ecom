'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Printer, Copy, FileSpreadsheet, Download, Search, ArrowUpDown, ChevronLeft, ChevronRight, Eye, AlertTriangle, RotateCcw } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import Spinner from '@/components/ui/Spinner';
import Modal from '@/components/ui/Modal';
import { Toast, useToast } from '@/components/ui/Toast';
import { DATE_PRESETS, resolvePresetRange, type DatePreset } from '@/components/expenses/dateRanges';
import { LARGE_DISCREPANCY_THRESHOLD, type Business, type Shift, type FinancingByProvider } from './constants';

interface ShiftRow extends Shift { total_sales: number; total_hours: number; }
interface ShiftSale {
  id: number; sale_date: string; total: number; cash_amount: number; online_amount: number; status: string; created_at: string;
  financing_provider: string | null; financing_amount: number; financing_status: string | null;
}
interface ShiftCashMovement { id: number; type: 'IN' | 'OUT'; amount: number; note: string | null; created_by_name: string | null; created_at: string; }
interface ShiftExpense { id: number; date: string; amount: number; category: string; paid_to: string | null; description: string | null; created_at: string; }
const isLargeDiscrepancy = (d: number | null) => d != null && Math.abs(d) >= LARGE_DISCREPANCY_THRESHOLD;

type SortKey = 'created_at' | 'cashier_name' | 'time_in' | 'time_out' | 'total_hours' | 'cash_sales' | 'online_sales' | 'total_sales' | 'financing_receivable' | 'starting_cash' | 'actual_cash' | 'discrepancy';

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: 'created_at', label: 'Date Created' },
  { key: 'cashier_name', label: 'Cashier' },
  { key: 'time_in', label: 'Time-In' },
  { key: 'time_out', label: 'Time-Out' },
  { key: 'total_hours', label: 'Total Hours', numeric: true },
  { key: 'cash_sales', label: 'Cash Sales', numeric: true },
  { key: 'online_sales', label: 'Online Sales', numeric: true },
  { key: 'total_sales', label: 'Total POS Sales', numeric: true },
  { key: 'financing_receivable', label: 'Financing Receivable', numeric: true },
  { key: 'starting_cash', label: 'Starting Cash', numeric: true },
  { key: 'actual_cash', label: 'Actual Cash', numeric: true },
  { key: 'discrepancy', label: 'Discrepancy', numeric: true },
];

const hoursBetween = (a: string, b: string | null) => b ? Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 3600000) : 0;

export default function CashierShiftsReportClient() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [preset, setPreset] = useState<DatePreset | null>('This Month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [businessId, setBusinessId] = useState('');
  const [username, setUsername] = useState('');

  const [rows, setRows] = useState<ShiftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const [viewing, setViewing] = useState<{ shift: ShiftRow; sales: ShiftSale[]; cashMovements: ShiftCashMovement[]; expenses: ShiftExpense[]; financingByProvider: FinancingByProvider[] } | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [reopening, setReopening] = useState(false);
  const { toast, showToast, clearToast } = useToast();

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(u => { if (u) setIsOwner(u.role === 'owner'); });
  }, []);

  const range = preset ? resolvePresetRange(preset, customFrom, customTo) : null;

  const buildQuery = useCallback(() => {
    const params = new URLSearchParams();
    if (range) { params.set('from', range.from); params.set('to', range.to); }
    if (businessId) params.set('business_id', businessId);
    if (username) params.set('username', username);
    return params;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, customFrom, customTo, businessId, username]);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const data = await fetch(`/api/pos/shifts?${buildQuery().toString()}`).then(r => r.json());
    const withTotals: ShiftRow[] = (data.rows ?? []).map((r: Shift) => ({
      ...r,
      total_sales: (r.cash_sales ?? 0) + (r.online_sales ?? 0),
      total_hours: hoursBetween(r.time_in, r.time_out),
    }));
    setRows(withTotals);
    setPage(1);
    setLoading(false);
  }, [buildQuery]);

  useEffect(() => { fetchRows(); }, [fetchRows]);
  useEffect(() => {
    fetch('/api/businesses').then(r => r.json()).then(d => setBusinesses(d.rows ?? []));
  }, []);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let result = rows;
    if (q) result = result.filter(r => (r.cashier_name ?? '').toLowerCase().includes(q) || (r.username ?? '').toLowerCase().includes(q));
    result = [...result].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av ?? '').localeCompare(String(bv ?? ''));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return result;
  }, [rows, search, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const paged = filteredRows.slice((page - 1) * pageSize, page * pageSize);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) { setSortDir(d => (d === 'asc' ? 'desc' : 'asc')); }
    else { setSortKey(key); setSortDir('desc'); }
  };

  const openShift = async (id: number) => {
    const data = await fetch(`/api/pos/shifts/${id}`).then(r => r.json());
    setViewing({
      shift: { ...data.shift, total_sales: (data.shift.cash_sales ?? 0) + (data.shift.online_sales ?? 0), total_hours: hoursBetween(data.shift.time_in, data.shift.time_out) },
      sales: data.sales ?? [], cashMovements: data.cashMovements ?? [], expenses: data.expenses ?? [],
      financingByProvider: data.financingByProvider ?? [],
    });
  };

  const reopenShift = async () => {
    if (!viewing) return;
    setReopening(true);
    try {
      const res = await fetch(`/api/pos/shifts/${viewing.shift.id}/reopen`, { method: 'PUT' });
      const data = await res.json();
      if (!res.ok) { showToast(data.error || 'Failed to reopen shift', 'error'); return; }
      showToast('Shift reopened — cashier can End Shift again with corrected values');
      setViewing(null);
      fetchRows();
    } finally { setReopening(false); }
  };

  const cellValue = (r: ShiftRow, key: SortKey) => {
    switch (key) {
      case 'created_at': return formatDate(r.created_at);
      case 'cashier_name': return r.cashier_name || '—';
      case 'time_in': return formatDate(r.time_in);
      case 'time_out': return r.time_out ? formatDate(r.time_out) : '—';
      case 'total_hours': return `${r.total_hours.toFixed(1)}h`;
      case 'cash_sales': return formatCurrency(r.cash_sales ?? 0);
      case 'online_sales': return formatCurrency(r.online_sales ?? 0);
      case 'total_sales': return formatCurrency(r.total_sales);
      case 'financing_receivable': return formatCurrency(r.financing_receivable ?? 0);
      case 'starting_cash': return formatCurrency(r.starting_cash);
      case 'actual_cash': return r.actual_cash != null ? formatCurrency(r.actual_cash) : '—';
      case 'discrepancy': return r.discrepancy != null ? formatCurrency(r.discrepancy) : '—';
    }
  };

  const doPrint = () => window.print();

  const doCopy = async () => {
    const headerLine = COLUMNS.map(c => c.label).join('\t');
    const bodyLines = filteredRows.map(r => COLUMNS.map(c => cellValue(r, c.key)).join('\t'));
    try {
      await navigator.clipboard.writeText([headerLine, ...bodyLines].join('\n'));
      showToast('Copied to clipboard');
    } catch {
      showToast('Failed to copy', 'error');
    }
  };

  const doExcel = () => { window.location.href = `/api/pos/reports/cashiers/export?${buildQuery().toString()}`; };

  const doCsv = () => {
    const headerLine = COLUMNS.map(c => c.label);
    const bodyRows = filteredRows.map(r => COLUMNS.map(c => cellValue(r, c.key)));
    const csv = [headerLine, ...bodyRows].map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'cashier-shifts-report.csv';
    a.click();
  };

  return (
    <div className="p-6 space-y-4">
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}

      <div className="flex items-center gap-3 print:hidden">
        <Link href="/pos/reports" className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"><ArrowLeft size={18} /></Link>
        <h1 className="text-xl font-bold text-gray-900">Cashier&apos;s Report</h1>
      </div>

      <div className="card space-y-3 print:hidden">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-[11px] text-gray-500 font-medium block mb-1">Username</label>
            <input className="form-input py-1.5 text-sm w-48" placeholder="Member Username" value={username} onChange={e => setUsername(e.target.value)} />
          </div>
          <div>
            <label className="text-[11px] text-gray-500 font-medium block mb-1">Business</label>
            <select className="form-input py-1.5 text-sm w-40" value={businessId} onChange={e => setBusinessId(e.target.value)}>
              <option value="">All Businesses</option>
              {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
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
            <input className="form-input py-1.5 text-sm pl-8 w-56" placeholder="Search cashier or username"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : filteredRows.length === 0 ? (
          <p className="text-center text-gray-400 text-sm py-12">No shifts match these filters.</p>
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
                  <th className="table-header print:hidden">Status</th>
                  <th className="table-header print:hidden">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((r, i) => (
                  <tr key={r.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="table-cell text-gray-500 whitespace-nowrap">{formatDate(r.created_at)}</td>
                    <td className="table-cell font-medium">{r.cashier_name || '—'}</td>
                    <td className="table-cell text-gray-500 whitespace-nowrap">{formatDate(r.time_in)}</td>
                    <td className="table-cell text-gray-500 whitespace-nowrap">{r.time_out ? formatDate(r.time_out) : '—'}</td>
                    <td className="table-cell tabular-nums">{r.total_hours.toFixed(1)}h</td>
                    <td className="table-cell tabular-nums">{formatCurrency(r.cash_sales ?? 0)}</td>
                    <td className="table-cell tabular-nums">{formatCurrency(r.online_sales ?? 0)}</td>
                    <td className="table-cell font-semibold tabular-nums">{formatCurrency(r.total_sales)}</td>
                    <td className="table-cell tabular-nums">{formatCurrency(r.financing_receivable ?? 0)}</td>
                    <td className="table-cell tabular-nums">{formatCurrency(r.starting_cash)}</td>
                    <td className="table-cell tabular-nums">{r.actual_cash != null ? formatCurrency(r.actual_cash) : '—'}</td>
                    <td className={`table-cell font-semibold tabular-nums ${r.discrepancy == null ? '' : r.discrepancy === 0 ? 'text-gray-700' : r.discrepancy > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      <span className="inline-flex items-center gap-1">
                        {isLargeDiscrepancy(r.discrepancy) && <AlertTriangle size={13} className="text-red-500" />}
                        {r.discrepancy != null ? formatCurrency(r.discrepancy) : '—'}
                      </span>
                    </td>
                    <td className="table-cell print:hidden">
                      <span className={r.status === 'Open' ? 'badge-amber' : 'badge-green'}>{r.status}</span>
                    </td>
                    <td className="table-cell print:hidden">
                      <button onClick={() => openShift(r.id)} className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-600" title="View"><Eye size={14} /></button>
                    </td>
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

      {viewing && (
        <Modal open onClose={() => setViewing(null)} title={`Shift — ${viewing.shift.cashier_name || 'Unknown'}`} size="lg">
          <div className="space-y-4">
            {isLargeDiscrepancy(viewing.shift.discrepancy) && (
              <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                <AlertTriangle size={16} className="shrink-0" />
                Large discrepancy on this shift ({formatCurrency(viewing.shift.discrepancy ?? 0)}) — worth a closer look.
              </div>
            )}
            {viewing.shift.notes && (
              <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-600">
                <p className="text-[11px] text-gray-500 font-semibold mb-1">Notes</p>
                {viewing.shift.notes}
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-[11px] text-gray-500">Time-In / Out</p>
                <p className="text-sm font-semibold">{formatDate(viewing.shift.time_in)}</p>
                <p className="text-xs text-gray-500">{viewing.shift.time_out ? formatDate(viewing.shift.time_out) : 'Still open'}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-[11px] text-gray-500">Total POS Sales</p>
                <p className="text-sm font-semibold tabular-nums">{formatCurrency(viewing.shift.total_sales)}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-[11px] text-gray-500">Starting → Actual Cash</p>
                <p className="text-sm font-semibold tabular-nums">{formatCurrency(viewing.shift.starting_cash)} → {viewing.shift.actual_cash != null ? formatCurrency(viewing.shift.actual_cash) : '—'}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-[11px] text-gray-500">Discrepancy</p>
                <p className={`text-sm font-semibold tabular-nums ${viewing.shift.discrepancy == null ? '' : viewing.shift.discrepancy === 0 ? '' : viewing.shift.discrepancy > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                  {viewing.shift.discrepancy != null ? formatCurrency(viewing.shift.discrepancy) : '—'}
                </p>
              </div>
            </div>

            {viewing.financingByProvider.length > 0 && (
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-[11px] text-gray-500 font-semibold mb-1.5">Financing Receivable</p>
                <div className="flex flex-wrap gap-4">
                  {viewing.financingByProvider.map(f => (
                    <div key={f.provider} className="flex items-baseline gap-1.5">
                      <span className="text-xs text-gray-500">{f.provider}</span>
                      <span className="text-sm font-semibold tabular-nums">{formatCurrency(f.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <p className="text-sm font-semibold text-gray-800 mb-2">Sales During This Shift ({viewing.sales.length})</p>
              {viewing.sales.length === 0 ? (
                <p className="text-center text-gray-400 text-sm py-6">No sales recorded during this shift.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      {['Sale #', 'Time', 'Cash', 'Online', 'Financing', 'Total', 'Status'].map(h => <th key={h} className="table-header">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {viewing.sales.map((s, i) => (
                      <tr key={s.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="table-cell font-medium tabular-nums">#{String(s.id).padStart(6, '0')}</td>
                        <td className="table-cell text-gray-500 whitespace-nowrap">{formatDate(s.created_at)}</td>
                        <td className="table-cell tabular-nums">{formatCurrency(s.cash_amount)}</td>
                        <td className="table-cell tabular-nums">{formatCurrency(s.online_amount)}</td>
                        <td className="table-cell tabular-nums">
                          {s.financing_provider ? `${s.financing_provider} · ${formatCurrency(s.financing_amount)} (${s.financing_status})` : '—'}
                        </td>
                        <td className="table-cell font-semibold tabular-nums">{formatCurrency(s.total)}</td>
                        <td className="table-cell"><span className={s.status === 'Voided' ? 'badge-red' : 'badge-green'}>{s.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {viewing.cashMovements.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-gray-800 mb-2">Cash In/Out ({viewing.cashMovements.length})</p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      {['Time', 'Type', 'Amount', 'Note', 'By'].map(h => <th key={h} className="table-header">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {viewing.cashMovements.map((m, i) => (
                      <tr key={m.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="table-cell text-gray-500 whitespace-nowrap">{formatDate(m.created_at)}</td>
                        <td className="table-cell"><span className={m.type === 'IN' ? 'badge-green' : 'badge-red'}>{m.type === 'IN' ? 'Cash In' : 'Cash Out'}</span></td>
                        <td className="table-cell font-semibold tabular-nums">{formatCurrency(m.amount)}</td>
                        <td className="table-cell text-gray-500">{m.note || '—'}</td>
                        <td className="table-cell text-gray-500">{m.created_by_name || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {viewing.expenses.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-gray-800 mb-2">Expenses During This Shift ({viewing.expenses.length})</p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      {['Time', 'Category', 'Paid To', 'Amount', 'Notes'].map(h => <th key={h} className="table-header">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {viewing.expenses.map((e, i) => (
                      <tr key={e.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="table-cell text-gray-500 whitespace-nowrap">{formatDate(e.created_at)}</td>
                        <td className="table-cell">{e.category}</td>
                        <td className="table-cell">{e.paid_to || '—'}</td>
                        <td className="table-cell font-semibold tabular-nums">{formatCurrency(e.amount)}</td>
                        <td className="table-cell text-gray-500">{e.description || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              {isOwner && viewing.shift.status === 'Closed' && (
                <button onClick={reopenShift} disabled={reopening} className="btn-secondary">
                  <RotateCcw size={14} /> {reopening ? 'Reopening...' : 'Reopen Shift'}
                </button>
              )}
              <button onClick={() => setViewing(null)} className="btn-secondary">Close</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
