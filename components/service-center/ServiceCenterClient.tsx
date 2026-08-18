'use client';

import { useEffect, useState, useCallback } from 'react';
import { Plus, Pencil, Trash2, Wrench, Banknote, PiggyBank, Users2, Wallet, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Toast, useToast } from '@/components/ui/Toast';
import Modal from '@/components/ui/Modal';
import Spinner from '@/components/ui/Spinner';
import RepairForm from './RepairForm';
import PendingPayout from './PendingPayout';
import LateCustomerPayments from './LateCustomerPayments';
import { toLocalISO, weekStart, weekLabel, payoutDate, shortDate, isCurrentWeek } from './weekUtils';
import { todayISO } from '@/lib/utils';

// Shared visual system for the five summary tiles — one icon-box size, one
// label/amount type scale, so the row reads as a single unified card system
// instead of five ad-hoc cards.
const ICON_BOX = 'w-11 h-11 rounded-xl flex items-center justify-center shrink-0';
const STAT_CARD = 'bg-white rounded-xl shadow-sm border border-gray-100 p-5 flex items-start gap-3.5';

const DATE_PRESETS = ['Today', 'Yesterday', 'Last 7 Days', 'This Month', 'Last Month'] as const;
type DatePreset = typeof DATE_PRESETS[number];

const SUMMARY_PERIODS = ['Daily', 'Weekly', 'Monthly'] as const;
type SummaryPeriod = typeof SUMMARY_PERIODS[number];

export interface Repair {
  id: number; repair_date: string; repair_details: string | null; unit_model: string | null;
  technician_name: string | null; order_no: string | null; receipt_no: string | null;
  cs_payment: number; cogs: number; labor_amount: number;
  bns_share: number; gerald_share: number; dp: number;
  status: 'ONGOING' | 'CUSTOMER PAID'; paid_to_tech: number; tech_paid_date: string | null;
}

export default function ServiceCenterClient() {
  const [repairs, setRepairs] = useState<Repair[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing]   = useState<Repair | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');
  const [activePreset, setActivePreset] = useState<DatePreset | null>(null);
  const [summaryPeriod, setSummaryPeriod] = useState<SummaryPeriod>('Weekly');
  const [summaryAnchor, setSummaryAnchor] = useState(todayISO());
  const [page, setPage]         = useState(1);
  const [pageSize, setPageSize] = useState(8);
  const { toast, showToast, clearToast } = useToast();

  const fetchData = useCallback(async () => {
    setLoading(true);
    const data = await fetch('/api/service-repairs').then(r => r.json());
    setRepairs(data.rows ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const anchor = new Date(summaryAnchor + 'T00:00:00');

  const summaryRange = (() => {
    if (summaryPeriod === 'Daily') return { from: summaryAnchor, to: summaryAnchor };
    if (summaryPeriod === 'Weekly') {
      const monday = weekStart(summaryAnchor);
      const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
      return { from: toLocalISO(monday), to: toLocalISO(sunday) };
    }
    const from = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const to   = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    return { from: toLocalISO(from), to: toLocalISO(to) };
  })();

  const summaryLabel = (() => {
    if (summaryPeriod === 'Daily') return formatDate(summaryAnchor);
    if (summaryPeriod === 'Weekly') return weekLabel(weekStart(summaryAnchor));
    return anchor.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
  })();

  const isCurrentPeriod = summaryAnchor === todayISO() ||
    (summaryPeriod !== 'Daily' && summaryRange.from <= todayISO() && todayISO() <= summaryRange.to);

  const shiftSummaryPeriod = (dir: 1 | -1) => {
    const d = new Date(summaryAnchor + 'T00:00:00');
    if (summaryPeriod === 'Daily') d.setDate(d.getDate() + dir);
    else if (summaryPeriod === 'Weekly') d.setDate(d.getDate() + dir * 7);
    else d.setMonth(d.getMonth() + dir);
    setSummaryAnchor(toLocalISO(d));
  };

  const summaryRepairs = repairs.filter(r => {
    const d = r.repair_date ? r.repair_date.slice(0, 10) : '';
    return d >= summaryRange.from && d <= summaryRange.to;
  });

  const totals = {
    total_cs_payment: summaryRepairs.reduce((s, r) => s + r.cs_payment, 0),
    total_labor:      summaryRepairs.reduce((s, r) => s + r.labor_amount, 0),
    total_bns:        summaryRepairs.reduce((s, r) => s + r.bns_share, 0),
    total_gerald:     summaryRepairs.reduce((s, r) => s + r.gerald_share, 0),
  };

  // "For Tech Payout" — unpaid technician share across ALL customer-paid jobs
  // (not limited to the summary period, since payout cutoffs are their own
  // weekly cycle), with the oldest unsettled Mon–Sun cutoff surfaced as the
  // one needing the most urgent attention.
  const pendingTech = repairs.filter(r => r.status === 'CUSTOMER PAID' && !r.paid_to_tech);
  const pendingTechGroups = new Map<string, Date>();
  for (const r of pendingTech) {
    const monday = weekStart(r.repair_date.slice(0, 10));
    pendingTechGroups.set(toLocalISO(monday), monday);
  }
  const oldestPendingWeek = [...pendingTechGroups.values()].sort((a, b) => toLocalISO(a).localeCompare(toLocalISO(b)))[0];
  const techPayoutTotal = pendingTech.reduce((s, r) => s + r.gerald_share, 0);
  const weekSunday = (monday: Date) => { const d = new Date(monday); d.setDate(monday.getDate() + 6); return d; };
  const shortWeekRange = (monday: Date) => {
    const sunday = weekSunday(monday);
    const dayOnly = (d: Date) => d.toLocaleDateString('en-PH', { day: 'numeric' });
    return monday.getMonth() === sunday.getMonth()
      ? `${shortDate(monday)}–${dayOnly(sunday)}`
      : `${shortDate(monday)}–${shortDate(sunday)}`;
  };
  // Still the current cutoff (accruing toward next Monday) vs an older,
  // already-passed cutoff that's now overdue.
  const payoutBadge = oldestPendingWeek
    ? isCurrentWeek(oldestPendingWeek)
      ? { label: 'Next Monday', cls: 'bg-amber-100 text-amber-700' }
      : { label: 'Payout Due', cls: 'bg-red-100 text-red-700' }
    : null;

  const periodOverviewLabel = summaryPeriod === 'Daily' ? 'Daily performance overview'
    : summaryPeriod === 'Weekly' ? 'Weekly performance overview'
    : 'Monthly performance overview';

  const weeklyStats = {
    total:          summaryRepairs.length,
    customerPaid:   summaryRepairs.filter(r => r.status === 'CUSTOMER PAID').length,
    ongoing:        summaryRepairs.filter(r => r.status === 'ONGOING').length,
    forTechPayout:  summaryRepairs.filter(r => r.status === 'CUSTOMER PAID' && !r.paid_to_tech).length,
  };

  const filtered = repairs.filter(r => {
    const d = r.repair_date ? r.repair_date.slice(0, 10) : '';
    if (dateFrom && d < dateFrom) return false;
    if (dateTo   && d > dateTo)   return false;
    return true;
  });

  useEffect(() => { setPage(1); }, [dateFrom, dateTo, pageSize]);

  const applyPreset = (preset: DatePreset) => {
    const now = new Date();
    const today = toLocalISO(now);
    if (preset === 'Today') {
      setDateFrom(today); setDateTo(today);
    } else if (preset === 'Yesterday') {
      const y = new Date(now); y.setDate(now.getDate() - 1);
      const ys = toLocalISO(y);
      setDateFrom(ys); setDateTo(ys);
    } else if (preset === 'Last 7 Days') {
      const from = new Date(now); from.setDate(now.getDate() - 6);
      setDateFrom(toLocalISO(from)); setDateTo(today);
    } else if (preset === 'This Month') {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      setDateFrom(toLocalISO(from)); setDateTo(today);
    } else if (preset === 'Last Month') {
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const to   = new Date(now.getFullYear(), now.getMonth(), 0);
      setDateFrom(toLocalISO(from)); setDateTo(toLocalISO(to));
    }
    setActivePreset(preset);
  };

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  const handleDelete = async (r: Repair) => {
    if (!confirm(`Delete repair entry "${r.repair_details ?? r.unit_model}"? This cannot be undone.`)) return;
    await fetch(`/api/service-repairs/${r.id}`, { method: 'DELETE' });
    showToast('Repair entry deleted');
    fetchData();
  };

  const statusBadge = (s: string) =>
    s === 'CUSTOMER PAID' ? <span className="badge-green">Customer Paid</span> : <span className="badge-amber">Ongoing</span>;

  const HEADERS = ['Date', 'Repair Details', 'Unit / Model', 'Repair Amount', 'COGS', 'Labor', 'BNS', 'Technician', 'DP', 'Status', 'Tech Paid', 'Actions'];

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Service Center Monitoring</h1>
          <p className="text-sm text-gray-500 mt-0.5">Track repair jobs, customer balances, labor split, and technician payouts</p>
        </div>
        <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary">
          <Plus size={16} /> Add Repair
        </button>
      </div>

      {/* Summary heading + period controls — grouped tightly as one block */}
      <div className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-sm font-semibold text-gray-700">Summary</p>
            <p className="text-xs text-gray-400 mt-0.5">{periodOverviewLabel} for the selected period</p>
          </div>
          <div className="flex items-center bg-gray-100 rounded-lg p-1 gap-0.5">
            {SUMMARY_PERIODS.map(p => (
              <button
                key={p}
                onClick={() => { setSummaryPeriod(p); setSummaryAnchor(todayISO()); }}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  summaryPeriod === p
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Period navigation — the selected range is the focal point, the
            jump-to-date picker stays visually secondary. */}
        <div className="flex flex-col items-center gap-1 pt-1">
          <div className="flex items-center gap-3">
            <button onClick={() => shiftSummaryPeriod(-1)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 shrink-0">
              <ChevronLeft size={18} />
            </button>
            <span className="text-lg font-bold text-gray-900 text-center tabular-nums">{summaryLabel}</span>
            <button onClick={() => shiftSummaryPeriod(1)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 shrink-0">
              <ChevronRight size={18} />
            </button>
          </div>
          {summaryPeriod === 'Weekly' && (
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Monday–Sunday Cutoff</p>
          )}
          <div className="flex items-center gap-2 mt-1.5">
            {summaryPeriod === 'Monthly' ? (
              <input
                type="month"
                className="text-xs text-gray-400 border border-gray-200 rounded-md px-2 py-1 bg-gray-50 w-auto focus:outline-none focus:ring-1 focus:ring-orange-300"
                value={summaryAnchor.slice(0, 7)}
                onChange={e => e.target.value && setSummaryAnchor(`${e.target.value}-01`)}
              />
            ) : (
              <input
                type="date"
                className="text-xs text-gray-400 border border-gray-200 rounded-md px-2 py-1 bg-gray-50 w-auto focus:outline-none focus:ring-1 focus:ring-orange-300"
                value={summaryAnchor}
                onChange={e => e.target.value && setSummaryAnchor(e.target.value)}
              />
            )}
            {!isCurrentPeriod && (
              <button
                onClick={() => setSummaryAnchor(todayISO())}
                className="text-xs text-orange-600 hover:text-orange-800 font-medium"
              >
                Back to Today
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <div className={STAT_CARD}>
          <div className={`${ICON_BOX} bg-blue-50`}><Banknote className="text-blue-500" size={20} /></div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-500">Total Repair Amount</p>
            <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">{formatCurrency(totals.total_cs_payment)}</p>
          </div>
        </div>
        <div className={STAT_CARD}>
          <div className={`${ICON_BOX} bg-green-50`}><PiggyBank className="text-green-600" size={20} /></div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-500">Total Labor Amount</p>
            <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">{formatCurrency(totals.total_labor)}</p>
          </div>
        </div>
        <div className={STAT_CARD}>
          <div className={`${ICON_BOX} bg-amber-50`}><Users2 className="text-amber-600" size={20} /></div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-500">BNS Share</p>
            <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">{formatCurrency(totals.total_bns)}</p>
          </div>
        </div>
        <div className={STAT_CARD}>
          <div className={`${ICON_BOX} bg-orange-50`}><Wrench className="text-orange-600" size={20} /></div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-500">Technician Share</p>
            <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">{formatCurrency(totals.total_gerald)}</p>
          </div>
        </div>
        <div className={STAT_CARD}>
          <div className={`${ICON_BOX} bg-red-50`}><Wallet className="text-red-500" size={20} /></div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-500">For Tech Payout</p>
            <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">{formatCurrency(techPayoutTotal)}</p>
            {oldestPendingWeek ? (
              <>
                <p className="text-xs text-gray-500 mt-1 leading-snug">
                  {pendingTech.length} job{pendingTech.length > 1 ? 's' : ''}<br />
                  Cutoff: {shortWeekRange(oldestPendingWeek)}<br />
                  Pay on {shortDate(payoutDate(oldestPendingWeek))}
                </p>
                {payoutBadge && (
                  <span className={`inline-block mt-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full ${payoutBadge.cls}`}>
                    {payoutBadge.label}
                  </span>
                )}
              </>
            ) : (
              <p className="text-xs text-gray-400 mt-1">Nothing pending</p>
            )}
          </div>
        </div>
      </div>

      {/* Compact at-a-glance line — intentionally not another row of cards */}
      <p className="text-xs text-gray-500 -mt-2">
        <span className="font-semibold text-gray-800">{weeklyStats.total}</span> Repair{weeklyStats.total === 1 ? '' : 's'}
        <span className="text-gray-300 mx-1.5">•</span>
        <span className="font-semibold text-gray-800">{weeklyStats.customerPaid}</span> Customer Paid
        <span className="text-gray-300 mx-1.5">•</span>
        <span className="font-semibold text-gray-800">{weeklyStats.ongoing}</span> Ongoing
        <span className="text-gray-300 mx-1.5">•</span>
        <span className="font-semibold text-gray-800">{weeklyStats.forTechPayout}</span> For Tech Payout
      </p>

      <LateCustomerPayments repairs={repairs} onSettled={fetchData} />

      <PendingPayout repairs={repairs} onPaid={fetchData} />

      {/* Date filter */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-gray-500 font-medium">Filter by date:</span>
        <div className="flex items-center bg-gray-100 rounded-lg p-1 gap-0.5">
          {DATE_PRESETS.map(p => (
            <button
              key={p}
              onClick={() => applyPreset(p)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all whitespace-nowrap ${
                activePreset === p
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
        <input type="date" className="form-input py-1.5 text-sm w-auto" value={dateFrom}
          onChange={e => { setDateFrom(e.target.value); setActivePreset(null); }} />
        <span className="text-gray-400 text-sm">—</span>
        <input type="date" className="form-input py-1.5 text-sm w-auto" value={dateTo}
          onChange={e => { setDateTo(e.target.value); setActivePreset(null); }} />
        {(dateFrom || dateTo) && (
          <button onClick={() => { setDateFrom(''); setDateTo(''); setActivePreset(null); }}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium">
            Clear
          </button>
        )}
        {(dateFrom || dateTo) && (
          <span className="text-xs text-gray-400">{filtered.length} of {repairs.length} entries</span>
        )}
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-sm text-gray-500 font-medium">Per page:</span>
          <select
            className="form-input py-1.5 text-sm w-auto"
            value={pageSize}
            onChange={e => setPageSize(Number(e.target.value))}
          >
            {[5, 8, 10, 20, 50].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>

      <div className="card">
        {loading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-400 text-sm">No repair entries yet.</p>
            <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary mt-4">
              <Plus size={16} /> Add First Repair
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  {HEADERS.slice(0, -1).map(h => <th key={h} className="table-header">{h}</th>)}
                  <th className="table-header sticky right-0 bg-white">{HEADERS[HEADERS.length - 1]}</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((r, i) => (
                  <tr key={r.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="table-cell text-gray-500 whitespace-nowrap">{r.repair_date ? formatDate(r.repair_date) : '—'}</td>
                    <td className="table-cell font-medium">{r.repair_details || '—'}</td>
                    <td className="table-cell text-gray-600">{r.unit_model || '—'}</td>
                    <td className="table-cell font-semibold">{formatCurrency(r.cs_payment)}</td>
                    <td className="table-cell text-gray-500">{formatCurrency(r.cogs)}</td>
                    <td className="table-cell">{formatCurrency(r.labor_amount)}</td>
                    <td className="table-cell text-blue-700">{formatCurrency(r.bns_share)}</td>
                    <td className="table-cell text-gray-600">{r.technician_name || '—'}</td>
                    <td className="table-cell text-gray-500">{r.dp ? formatCurrency(r.dp) : '—'}</td>
                    <td className="table-cell">{statusBadge(r.status)}</td>
                    <td className="table-cell">
                      {r.paid_to_tech ? <span className="badge-green">Paid</span> : <span className="badge-gray">Unpaid</span>}
                    </td>
                    <td className={`table-cell sticky right-0 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                      <div className="flex items-center gap-1">
                        <button onClick={() => { setEditing(r); setShowForm(true); }}
                          className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-600 transition-colors" title="Edit">
                          <Pencil size={15} />
                        </button>
                        <button onClick={() => handleDelete(r)}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-500 transition-colors" title="Delete">
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && filtered.length > 0 && totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
            <span className="text-xs text-gray-500">
              Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filtered.length)} of {filtered.length}
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-40">
                <ChevronLeft size={16} />
              </button>
              <span className="text-sm px-2">{page} / {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-40">
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      <Modal open={showForm} onClose={() => setShowForm(false)} title={editing ? 'Edit Repair Entry' : 'Add Repair Entry'} size="lg">
        <RepairForm
          initial={editing ?? undefined}
          onSuccess={() => { setShowForm(false); showToast(editing ? 'Repair entry updated!' : 'Repair entry added!'); fetchData(); }}
          onCancel={() => setShowForm(false)}
        />
      </Modal>
    </div>
  );
}
