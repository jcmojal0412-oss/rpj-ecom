'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Plus, Pencil, Trash2, ChevronLeft, ChevronRight,
  Banknote, Package, PiggyBank, Megaphone, Wrench, Wallet, AlertTriangle,
} from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend,
} from 'recharts';
import { formatCurrency, formatDate, todayISO } from '@/lib/utils';
import { Toast, useToast } from '@/components/ui/Toast';
import Modal from '@/components/ui/Modal';
import AddMarketingExpenseModal from './AddMarketingExpenseModal';
import type { Repair } from './ServiceCenterClient';
import type { MarketingExpense } from '@/lib/service-center-marketing';
import {
  toLocalISO, weekStart, weekLabel, payoutDate, shortDate, shortWeekRange,
  monthStart, monthEnd, monthLabel, monthLabelShort, shiftMonth, yearStart, yearEnd,
} from './weekUtils';

type PeriodType = 'Weekly' | 'Monthly' | 'Quarter' | 'Year' | 'Custom';

// One row of quick presets — each sets both the period type and where it's
// anchored in one click. "Weekly"/"Monthly" (shift 0) land on the current
// one; arrows still work afterward to browse further back/forward from
// wherever a preset lands.
const PRESETS: { key: string; label: string; type: PeriodType; shift: number }[] = [
  { key: 'weekly',     label: 'Weekly',        type: 'Weekly',  shift: 0 },
  { key: 'last_week',  label: 'Last Week',     type: 'Weekly',  shift: -1 },
  { key: 'this_month', label: 'This Month',    type: 'Monthly', shift: 0 },
  { key: 'last_month', label: 'Last Month',    type: 'Monthly', shift: -1 },
  { key: 'last_3mo',   label: 'Last 3 Months', type: 'Quarter', shift: 0 },
  { key: 'this_year',  label: 'This Year',     type: 'Year',    shift: 0 },
  { key: 'custom',     label: 'Custom',        type: 'Custom',  shift: 0 },
];

const ICON_BOX = 'w-11 h-11 rounded-xl flex items-center justify-center shrink-0';
const STAT_CARD = 'bg-white rounded-xl shadow-sm border border-gray-100 p-5 flex items-start gap-3.5';

interface DateRange { from: string; to: string; }

function inRange(dateStr: string | null, r: DateRange): boolean {
  const d = dateStr ? dateStr.slice(0, 10) : '';
  return d >= r.from && d <= r.to;
}

const sum = (arr: number[]) => arr.reduce((s, n) => s + n, 0);

type Dir = 'up' | 'down' | 'flat';
interface Delta { pct: number | null; dir: Dir; }

function computeDelta(curr: number, prev: number): Delta {
  if (prev === 0) {
    if (curr === 0) return { pct: 0, dir: 'flat' };
    return { pct: null, dir: 'up' };
  }
  const pct = ((curr - prev) / Math.abs(prev)) * 100;
  return { pct, dir: pct > 0.05 ? 'up' : pct < -0.05 ? 'down' : 'flat' };
}

// Marketing Expense uses tone="expense" — always orange, never green/red,
// because a higher marketing spend isn't automatically a good result.
function DeltaBadge({ delta, tone }: { delta: Delta; tone: 'outcome' | 'expense' }) {
  const color = tone === 'expense'
    ? 'text-orange-600'
    : delta.dir === 'up' ? 'text-green-600' : delta.dir === 'down' ? 'text-red-500' : 'text-gray-400';
  const arrow = delta.dir === 'up' ? '▲' : delta.dir === 'down' ? '▼' : '—';
  const label = delta.pct == null ? 'New' : `${Math.abs(delta.pct).toFixed(1)}%`;
  return <span className={`inline-flex items-center gap-1 text-xs font-semibold ${color}`}>{arrow} {label}</span>;
}

function ComparisonRow({ label, curr, prev, delta, money = true, tone = 'outcome' }: {
  label: string; curr: number; prev: number; delta: Delta; money?: boolean; tone?: 'outcome' | 'expense';
}) {
  const fmt = (n: number) => money ? formatCurrency(n) : String(n);
  return (
    <div className="flex items-center justify-between text-sm border-b border-gray-50 pb-2.5 last:border-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-gray-700 font-medium">{label}</p>
        <p className="text-xs text-gray-400 mt-0.5 tabular-nums">{fmt(curr)} vs {fmt(prev)}</p>
      </div>
      <DeltaBadge delta={delta} tone={tone} />
    </div>
  );
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="font-semibold text-gray-900 mt-0.5 tabular-nums">{value}</p>
    </div>
  );
}

function CurrentDot(props: { cx?: number; cy?: number; stroke?: string; payload?: { isCurrent?: boolean } }) {
  const { cx, cy, stroke, payload } = props;
  if (cx == null || cy == null) return <></>;
  if (!payload?.isCurrent) return <circle cx={cx} cy={cy} r={3} fill={stroke} stroke="none" />;
  return (
    <g>
      <circle cx={cx} cy={cy} r={6} fill="#fff" stroke={stroke} strokeWidth={2.5} />
      <circle cx={cx} cy={cy} r={2.5} fill={stroke} />
    </g>
  );
}

export default function CEOOverviewClient() {
  const [repairs, setRepairs]   = useState<Repair[]>([]);
  const [expenses, setExpenses] = useState<MarketingExpense[]>([]);
  const [periodType, setPeriodType] = useState<PeriodType>('Weekly');
  const [activePreset, setActivePreset] = useState<string>('weekly');
  const [anchor, setAnchor]     = useState(todayISO());
  const [customFrom, setCustomFrom] = useState(todayISO());
  const [customTo, setCustomTo]     = useState(todayISO());
  const [chartPeriod, setChartPeriod] = useState<'Weekly' | 'Monthly'>('Weekly');
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [editingExpense, setEditingExpense]     = useState<MarketingExpense | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const { toast, showToast, clearToast } = useToast();

  const fetchData = useCallback(async () => {
    const [repairsRes, expensesRes] = await Promise.all([
      fetch('/api/service-repairs').then(r => r.json()),
      fetch('/api/service-center/marketing-expenses').then(r => r.json()),
    ]);
    setRepairs(repairsRes.rows ?? []);
    setExpenses(expensesRes.rows ?? []);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ---- Period resolution ----
  const weeklyMonday  = weekStart(anchor);
  const weeklySunday  = (() => { const d = new Date(weeklyMonday); d.setDate(weeklyMonday.getDate() + 6); return d; })();
  const monthlyFirst  = monthStart(anchor);
  const monthlyLast   = monthEnd(monthlyFirst);
  // "Last 3 Months" = the current calendar month plus the 2 full months
  // before it (e.g. viewed in August: Jun–Aug), same rolling convention as
  // This Month/Last Month rather than fixed Q1–Q4 quarters.
  const quarterFirst  = shiftMonth(monthlyFirst, -2);
  const quarterLast   = monthlyLast;
  const yearlyFirst    = yearStart(anchor);
  const yearlyLast     = yearEnd(yearlyFirst);

  const range: DateRange = periodType === 'Weekly'
    ? { from: toLocalISO(weeklyMonday), to: toLocalISO(weeklySunday) }
    : periodType === 'Monthly'
    ? { from: toLocalISO(monthlyFirst), to: toLocalISO(monthlyLast) }
    : periodType === 'Quarter'
    ? { from: toLocalISO(quarterFirst), to: toLocalISO(quarterLast) }
    : periodType === 'Year'
    ? { from: toLocalISO(yearlyFirst), to: toLocalISO(yearlyLast) }
    : { from: customFrom, to: customTo };

  const periodLabel = periodType === 'Weekly' ? weekLabel(weeklyMonday)
    : periodType === 'Monthly' ? monthLabel(monthlyFirst)
    : periodType === 'Quarter' ? `${monthLabelShort(quarterFirst)} – ${monthLabel(quarterLast)}`
    : periodType === 'Year' ? String(yearlyFirst.getFullYear())
    : `${formatDate(customFrom)} – ${formatDate(customTo)}`;

  const isCurrentPeriod = periodType === 'Weekly' ? toLocalISO(weeklyMonday) === toLocalISO(weekStart(todayISO()))
    : periodType === 'Monthly' ? toLocalISO(monthlyFirst) === toLocalISO(monthStart(todayISO()))
    : periodType === 'Quarter' ? toLocalISO(quarterLast) === toLocalISO(monthEnd(monthStart(todayISO())))
    : periodType === 'Year' ? yearlyFirst.getFullYear() === yearStart(todayISO()).getFullYear()
    : true;

  const shiftPeriod = (dir: 1 | -1) => {
    setActivePreset('');
    const d = new Date(anchor + 'T00:00:00');
    if (periodType === 'Weekly') d.setDate(d.getDate() + dir * 7);
    else if (periodType === 'Monthly') d.setMonth(d.getMonth() + dir);
    else if (periodType === 'Quarter') d.setMonth(d.getMonth() + dir * 3);
    else d.setFullYear(d.getFullYear() + dir);
    setAnchor(toLocalISO(d));
  };

  const prevRange: DateRange = (() => {
    if (periodType === 'Weekly') {
      const prevMonday = new Date(weeklyMonday); prevMonday.setDate(weeklyMonday.getDate() - 7);
      const prevSunday = new Date(prevMonday); prevSunday.setDate(prevMonday.getDate() + 6);
      return { from: toLocalISO(prevMonday), to: toLocalISO(prevSunday) };
    }
    if (periodType === 'Monthly') {
      const prevFirst = shiftMonth(monthlyFirst, -1);
      return { from: toLocalISO(prevFirst), to: toLocalISO(monthEnd(prevFirst)) };
    }
    if (periodType === 'Quarter') {
      const prevFirst = shiftMonth(quarterFirst, -3);
      const prevLast = monthEnd(shiftMonth(prevFirst, 2));
      return { from: toLocalISO(prevFirst), to: toLocalISO(prevLast) };
    }
    if (periodType === 'Year') {
      const prevFirst = new Date(yearlyFirst.getFullYear() - 1, 0, 1);
      return { from: toLocalISO(prevFirst), to: toLocalISO(yearEnd(prevFirst)) };
    }
    const fromD = new Date(customFrom + 'T00:00:00');
    const toD   = new Date(customTo + 'T00:00:00');
    const spanDays = Math.max(1, Math.round((toD.getTime() - fromD.getTime()) / 86400000) + 1);
    const prevTo = new Date(fromD); prevTo.setDate(fromD.getDate() - 1);
    const prevFrom = new Date(prevTo); prevFrom.setDate(prevTo.getDate() - spanDays + 1);
    return { from: toLocalISO(prevFrom), to: toLocalISO(prevTo) };
  })();

  const vsLabel = periodType === 'Weekly' ? 'vs last week'
    : periodType === 'Monthly' ? 'vs last month'
    : periodType === 'Quarter' ? 'vs previous 3 months'
    : periodType === 'Year' ? 'vs last year'
    : 'vs previous period';
  const comparisonLabel = periodType === 'Weekly' ? 'This Week vs Last Week'
    : periodType === 'Monthly' ? 'This Month vs Last Month'
    : periodType === 'Quarter' ? 'Last 3 Months vs Previous 3 Months'
    : periodType === 'Year' ? 'This Year vs Last Year'
    : 'This Period vs Previous Period';

  const applyPreset = (preset: typeof PRESETS[number]) => {
    setPeriodType(preset.type);
    setActivePreset(preset.key);
    if (preset.type === 'Custom') return;
    const base = todayISO();
    if (preset.type === 'Weekly') {
      const d = new Date(base + 'T00:00:00'); d.setDate(d.getDate() + preset.shift * 7);
      setAnchor(toLocalISO(d));
    } else if (preset.type === 'Monthly') {
      const d = new Date(base + 'T00:00:00'); d.setMonth(d.getMonth() + preset.shift);
      setAnchor(toLocalISO(d));
    } else {
      setAnchor(base);
    }
  };

  // ---- Period-scoped data ----
  const periodRepairs = repairs.filter(r => inRange(r.repair_date, range));
  const prevRepairs   = repairs.filter(r => inRange(r.repair_date, prevRange));
  const periodExpenses = expenses.filter(e => inRange(e.expense_date, range));
  const prevExpenses   = expenses.filter(e => inRange(e.expense_date, prevRange));

  const repairSales     = sum(periodRepairs.map(r => r.cs_payment));
  const prevRepairSales = sum(prevRepairs.map(r => r.cs_payment));
  const cogsTotal     = sum(periodRepairs.map(r => r.cogs));
  const prevCogsTotal = sum(prevRepairs.map(r => r.cogs));
  const bnsIncome        = sum(periodRepairs.map(r => r.bns_share));
  const prevBnsIncome    = sum(prevRepairs.map(r => r.bns_share));
  const marketingExpense     = sum(periodExpenses.map(e => e.amount));
  const prevMarketingExpense = sum(prevExpenses.map(e => e.amount));
  const netIncome     = bnsIncome - marketingExpense;
  const prevNetIncome = prevBnsIncome - prevMarketingExpense;
  const technicianPayout = sum(periodRepairs.map(r => r.gerald_share));

  const completedCount     = periodRepairs.filter(r => r.status === 'CUSTOMER PAID').length;
  const prevCompletedCount = prevRepairs.filter(r => r.status === 'CUSTOMER PAID').length;
  const ongoingCount       = periodRepairs.filter(r => r.status === 'ONGOING').length;
  const periodOutstanding  = sum(periodRepairs.filter(r => r.status === 'ONGOING').map(r => r.cs_payment));

  // Customer balances don't reset per period — the KPI card is a running,
  // all-time warning metric, not scoped to the selected week/month.
  const outstandingRepairs = repairs.filter(r => r.status === 'ONGOING');
  const globalOutstandingTotal = sum(outstandingRepairs.map(r => r.cs_payment));
  const globalOutstandingCount = outstandingRepairs.length;

  const salesDelta     = computeDelta(repairSales, prevRepairSales);
  const cogsDelta      = computeDelta(cogsTotal, prevCogsTotal);
  const bnsDelta       = computeDelta(bnsIncome, prevBnsIncome);
  const marketingDelta = computeDelta(marketingExpense, prevMarketingExpense);
  const netDelta       = computeDelta(netIncome, prevNetIncome);
  const completedDelta = computeDelta(completedCount, prevCompletedCount);

  const marketingROI = marketingExpense > 0 ? ((bnsIncome - marketingExpense) / marketingExpense) * 100 : null;
  const costPerRepair = marketingExpense > 0 && periodRepairs.length > 0 ? marketingExpense / periodRepairs.length : null;

  const techCutoffLabel = periodType === 'Weekly' ? shortWeekRange(weeklyMonday) : null;
  const techPayDate     = periodType === 'Weekly' ? shortDate(payoutDate(weeklyMonday)) : null;

  // ---- Trend chart: trailing 5 weeks or 6 months, anchored to the current
  // selection (Custom has no natural weekly/monthly anchor, so it falls
  // back to today). ----
  const chartAnchor = periodType === 'Custom' ? todayISO() : anchor;
  const chartData = (() => {
    const points: { label: string; bns: number; marketing: number; isCurrent: boolean }[] = [];
    if (chartPeriod === 'Weekly') {
      const currentMonday = weekStart(chartAnchor);
      for (let i = 4; i >= 0; i--) {
        const monday = new Date(currentMonday); monday.setDate(currentMonday.getDate() - i * 7);
        const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
        const r = { from: toLocalISO(monday), to: toLocalISO(sunday) };
        points.push({
          label: shortWeekRange(monday),
          bns: sum(repairs.filter(x => inRange(x.repair_date, r)).map(x => x.bns_share)),
          marketing: sum(expenses.filter(x => inRange(x.expense_date, r)).map(x => x.amount)),
          isCurrent: i === 0,
        });
      }
    } else {
      const currentFirst = monthStart(chartAnchor);
      for (let i = 5; i >= 0; i--) {
        const first = shiftMonth(currentFirst, -i);
        const last = monthEnd(first);
        const r = { from: toLocalISO(first), to: toLocalISO(last) };
        points.push({
          label: monthLabelShort(first),
          bns: sum(repairs.filter(x => inRange(x.repair_date, r)).map(x => x.bns_share)),
          marketing: sum(expenses.filter(x => inRange(x.expense_date, r)).map(x => x.amount)),
          isCurrent: i === 0,
        });
      }
    }
    return points;
  })();

  const handleDeleteExpense = async (e: MarketingExpense) => {
    if (!confirm(`Delete this marketing expense (${formatCurrency(e.amount)} — ${e.category})? This cannot be undone.`)) return;
    await fetch(`/api/service-center/marketing-expenses/${e.id}`, { method: 'DELETE' });
    showToast('Marketing expense deleted');
    fetchData();
  };

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}

      <div>
        <h1 className="text-2xl font-bold text-gray-900">CEO Overview</h1>
        <p className="text-sm text-gray-500 mt-0.5">Service Center performance at a glance — income, technician payouts, and customer balances</p>
      </div>

      {/* Period selector */}
      <div className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <p className="text-sm font-semibold text-gray-700">Period</p>
          <div className="flex items-center bg-gray-100 rounded-lg p-1 gap-0.5 flex-wrap">
            {PRESETS.map(p => (
              <button
                key={p.key}
                onClick={() => applyPreset(p)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all whitespace-nowrap ${
                  activePreset === p.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {periodType === 'Custom' ? (
          <div className="flex items-center justify-center gap-3 flex-wrap pt-1">
            <input type="date" className="form-input py-1.5 text-sm w-auto" value={customFrom}
              onChange={e => e.target.value && setCustomFrom(e.target.value)} />
            <span className="text-gray-400 text-sm">—</span>
            <input type="date" className="form-input py-1.5 text-sm w-auto" value={customTo}
              onChange={e => e.target.value && setCustomTo(e.target.value)} />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1 pt-1">
            <div className="flex items-center gap-3">
              <button onClick={() => shiftPeriod(-1)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 shrink-0">
                <ChevronLeft size={18} />
              </button>
              <span className="text-lg font-bold text-gray-900 text-center tabular-nums">{periodLabel}</span>
              <button onClick={() => shiftPeriod(1)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 shrink-0">
                <ChevronRight size={18} />
              </button>
            </div>
            {periodType === 'Weekly' && (
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Monday–Sunday Cutoff</p>
            )}
            {!isCurrentPeriod && (
              <button
                onClick={() => { setAnchor(todayISO()); setActivePreset(PRESETS.find(p => p.type === periodType && p.shift === 0)?.key ?? ''); }}
                className="text-xs text-orange-600 hover:text-orange-800 font-medium mt-1"
              >
                Back to Today
              </button>
            )}
          </div>
        )}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className={STAT_CARD}>
          <div className={`${ICON_BOX} bg-blue-50`}><Banknote className="text-blue-500" size={20} /></div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-500">Repair Sales</p>
            <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">{formatCurrency(repairSales)}</p>
            <div className="mt-1 flex items-center gap-1.5">
              <DeltaBadge delta={salesDelta} tone="outcome" />
              <span className="text-[11px] text-gray-400">{vsLabel}</span>
            </div>
          </div>
        </div>

        <div className={STAT_CARD}>
          <div className={`${ICON_BOX} bg-gray-100`}><Package className="text-gray-500" size={20} /></div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-500">COGS (Parts Cost)</p>
            <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">{formatCurrency(cogsTotal)}</p>
            <div className="mt-1 flex items-center gap-1.5">
              <DeltaBadge delta={cogsDelta} tone="expense" />
              <span className="text-[11px] text-gray-400">{vsLabel}</span>
            </div>
          </div>
        </div>

        <div className={STAT_CARD}>
          <div className={`${ICON_BOX} bg-green-50`}><PiggyBank className="text-green-600" size={20} /></div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-500">BNS Income</p>
            <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">{formatCurrency(bnsIncome)}</p>
            <div className="mt-1 flex items-center gap-1.5">
              <DeltaBadge delta={bnsDelta} tone="outcome" />
              <span className="text-[11px] text-gray-400">{vsLabel}</span>
            </div>
          </div>
        </div>

        <div className={STAT_CARD}>
          <div className={`${ICON_BOX} bg-orange-50`}><Megaphone className="text-orange-600" size={20} /></div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-500">Marketing Expense</p>
            <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">{formatCurrency(marketingExpense)}</p>
            <div className="mt-1 flex items-center gap-1.5">
              <DeltaBadge delta={marketingDelta} tone="expense" />
              <span className="text-[11px] text-gray-400">{vsLabel}</span>
            </div>
          </div>
        </div>

        <div className={STAT_CARD}>
          <div className={`${ICON_BOX} bg-green-50`}><Wallet className="text-green-600" size={20} /></div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-500">Net Income</p>
            <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">{formatCurrency(netIncome)}</p>
            <div className="mt-1 flex items-center gap-1.5">
              <DeltaBadge delta={netDelta} tone="outcome" />
              <span className="text-[11px] text-gray-400">{vsLabel}</span>
            </div>
          </div>
        </div>

        <div className={STAT_CARD}>
          <div className={`${ICON_BOX} bg-orange-50`}><Wrench className="text-orange-600" size={20} /></div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-500">Technician Payout</p>
            <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">{formatCurrency(technicianPayout)}</p>
            {techCutoffLabel && (
              <p className="text-xs text-gray-500 mt-1 leading-snug">
                Cutoff: {techCutoffLabel}<br />
                Pay on {techPayDate}
              </p>
            )}
          </div>
        </div>

        <div className={STAT_CARD}>
          <div className={`${ICON_BOX} bg-red-50`}><AlertTriangle className="text-red-500" size={20} /></div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-500">Customer Outstanding</p>
            <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">{formatCurrency(globalOutstandingTotal)}</p>
            <p className="text-xs text-gray-500 mt-1">{globalOutstandingCount} unpaid job{globalOutstandingCount === 1 ? '' : 's'}</p>
          </div>
        </div>
      </div>

      {/* Weekly summary line */}
      <p className="text-xs text-gray-500 -mt-2">
        <span className="font-semibold text-gray-800">{periodRepairs.length}</span> Repairs
        <span className="text-gray-300 mx-1.5">•</span>
        <span className="font-semibold text-gray-800">{completedCount}</span> Completed
        <span className="text-gray-300 mx-1.5">•</span>
        <span className="font-semibold text-gray-800">{ongoingCount}</span> Ongoing
        <span className="text-gray-300 mx-1.5">•</span>
        <span className="font-semibold text-gray-800">{formatCurrency(periodOutstanding)}</span> Outstanding
      </p>

      {/* Trend chart + Performance comparison */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
            <div>
              <p className="text-sm font-semibold text-gray-800">Service Center Performance</p>
              <p className="text-xs text-gray-400 mt-0.5">BNS Income vs Marketing Expense</p>
            </div>
            <div className="flex items-center bg-gray-100 rounded-lg p-1 gap-0.5">
              {(['Weekly', 'Monthly'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => setChartPeriod(p)}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                    chartPeriod === p ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} />
              <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} tickFormatter={v => `₱${(v / 1000).toFixed(0)}k`} width={50} />
              <Tooltip formatter={(val: number) => formatCurrency(val)} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="bns" name="BNS Income" stroke="#16A34A" strokeWidth={2.5} dot={<CurrentDot />} />
              <Line type="monotone" dataKey="marketing" name="Marketing Expense" stroke="#F97316" strokeWidth={2} dot={<CurrentDot />} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <p className="text-sm font-semibold text-gray-800 mb-1">Performance Comparison</p>
          <p className="text-xs text-gray-400 mb-4">{comparisonLabel}</p>
          <div className="space-y-3">
            <ComparisonRow label="Repair Sales" curr={repairSales} prev={prevRepairSales} delta={salesDelta} />
            <ComparisonRow label="COGS (Parts Cost)" curr={cogsTotal} prev={prevCogsTotal} delta={cogsDelta} tone="expense" />
            <ComparisonRow label="BNS Income" curr={bnsIncome} prev={prevBnsIncome} delta={bnsDelta} />
            <ComparisonRow label="Marketing Expense" curr={marketingExpense} prev={prevMarketingExpense} delta={marketingDelta} tone="expense" />
            <ComparisonRow label="Net Income" curr={netIncome} prev={prevNetIncome} delta={netDelta} />
            <ComparisonRow label="Completed Repairs" curr={completedCount} prev={prevCompletedCount} delta={completedDelta} money={false} />
          </div>
        </div>
      </div>

      {/* Marketing efficiency + expense log */}
      <div className="card space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-sm font-semibold text-gray-800">Marketing</p>
            <p className="text-xs text-gray-400 mt-0.5">Efficiency for the selected period, and the full spend log</p>
          </div>
          <button onClick={() => { setEditingExpense(null); setShowExpenseModal(true); }} className="btn-primary text-xs py-1.5">
            <Plus size={14} /> Add Marketing Expense
          </button>
        </div>

        <div className="flex flex-wrap gap-8">
          <div>
            <p className="text-xs text-gray-500">Marketing ROI</p>
            <p className="text-base font-bold text-gray-900 mt-0.5 tabular-nums">{marketingROI == null ? 'N/A' : `${marketingROI.toFixed(1)}%`}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Cost per Repair</p>
            <p className="text-base font-bold text-gray-900 mt-0.5 tabular-nums">{costPerRepair == null ? 'N/A' : formatCurrency(costPerRepair)}</p>
          </div>
        </div>

        <div>
          <button onClick={() => setShowHistory(s => !s)} className="text-xs font-semibold text-orange-600 hover:text-orange-800">
            {showHistory ? 'Hide Marketing Expenses' : 'View Marketing Expenses'}
          </button>
          {showHistory && (
            expenses.length === 0 ? (
              <p className="text-sm text-gray-400 py-3">No marketing expenses recorded yet.</p>
            ) : (
              <div className="overflow-x-auto mt-3">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="table-header">Date</th>
                      <th className="table-header">Category</th>
                      <th className="table-header">Description</th>
                      <th className="table-header">Amount</th>
                      <th className="table-header">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expenses.map(e => (
                      <tr key={e.id} className="border-b border-gray-50">
                        <td className="table-cell whitespace-nowrap text-gray-500">{formatDate(e.expense_date)}</td>
                        <td className="table-cell">{e.category}</td>
                        <td className="table-cell text-gray-600">{e.description || '—'}</td>
                        <td className="table-cell font-semibold">{formatCurrency(e.amount)}</td>
                        <td className="table-cell">
                          <div className="flex items-center gap-1">
                            <button onClick={() => { setEditingExpense(e); setShowExpenseModal(true); }}
                              className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-600 transition-colors" title="Edit">
                              <Pencil size={14} />
                            </button>
                            <button onClick={() => handleDeleteExpense(e)}
                              className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-500 transition-colors" title="Delete">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>
      </div>

      {/* Quick CEO summary */}
      <div className="card">
        <p className="text-sm font-semibold text-gray-800 mb-1">Quick CEO Summary</p>
        <p className="text-xs text-gray-400 mb-4">{periodLabel}</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-4 text-sm">
          <SummaryLine label="Repair Sales" value={formatCurrency(repairSales)} />
          <SummaryLine label="COGS (Parts Cost)" value={formatCurrency(cogsTotal)} />
          <SummaryLine label="BNS Income" value={formatCurrency(bnsIncome)} />
          <SummaryLine label="Marketing Expense" value={formatCurrency(marketingExpense)} />
          <SummaryLine label="Net Income" value={formatCurrency(netIncome)} />
          <SummaryLine label="Technician Share" value={formatCurrency(technicianPayout)} />
          <SummaryLine label="Customer Outstanding" value={formatCurrency(globalOutstandingTotal)} />
          <SummaryLine label="Repairs Completed" value={`${completedCount} / ${periodRepairs.length}`} />
        </div>
      </div>

      <Modal open={showExpenseModal} onClose={() => setShowExpenseModal(false)} title={editingExpense ? 'Edit Marketing Expense' : 'Add Marketing Expense'} size="md">
        <AddMarketingExpenseModal
          initial={editingExpense ?? undefined}
          onSuccess={() => { setShowExpenseModal(false); showToast(editingExpense ? 'Marketing expense updated!' : 'Marketing expense added!'); fetchData(); }}
          onCancel={() => setShowExpenseModal(false)}
        />
      </Modal>
    </div>
  );
}
