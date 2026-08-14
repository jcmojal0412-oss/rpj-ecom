'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Megaphone, TrendingUp, Users, Footprints, Target, Percent, Gauge, Wallet,
  ArrowUp, ArrowDown, Download, ArrowUpDown,
} from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { formatCurrency, formatDate, todayISO } from '@/lib/utils';
import {
  PERIOD_OPTIONS, type PeriodKey,
  computeCAC, computeConversionRate, computeROAS, computeAvgSpendPerBuyer,
} from '@/lib/marketing-analytics';

interface Kpis {
  marketing_spend: number; gross_sales: number; total_buyers: number; new_customers: number; store_visits: number;
  cac: number | null; conversion_rate: number | null; roas: number | null; avg_spend_per_buyer: number | null;
}
interface Changes {
  marketing_spend: number | null; gross_sales: number | null; total_buyers: number | null; store_visits: number | null;
  cac: number | null; conversion_rate: number | null; roas: number | null; avg_spend_per_buyer: number | null;
}
interface ChartPoint { label: string; marketing_spend: number; gross_sales: number; total_buyers: number; store_visits: number; }
interface DailyRow {
  entry_date: string; marketing_spend: number; gross_sales: number;
  total_buyers: number; new_customers: number; store_visits: number;
}
interface DashboardResponse {
  range: { from: string; to: string; granularity: 'day' | 'week' | 'month' };
  kpis: Kpis; previousKpis: Kpis; changes: Changes;
  chart: ChartPoint[]; dailyRows: DailyRow[];
}

function money(n: number | null): string { return n == null ? '—' : formatCurrency(n); }
function moneyWhole(n: number): string { return `₱${Math.round(n).toLocaleString()}`; }
function pctStr(n: number | null): string { return n == null ? '—' : `${n.toFixed(2)}%`; }
function timesStr(n: number | null): string { return n == null ? '—' : `${n.toFixed(2)}x`; }

export default function PerformanceDashboardClient() {
  const [period, setPeriod] = useState<PeriodKey>('this_month');
  const [customFrom, setCustomFrom] = useState(todayISO());
  const [customTo, setCustomTo] = useState(todayISO());
  const [appliedCustom, setAppliedCustom] = useState({ from: todayISO(), to: todayISO() });
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    setLoading(true);
    setLoadError(false);
    const params = new URLSearchParams({ period });
    if (period === 'custom') {
      params.set('from', appliedCustom.from);
      params.set('to', appliedCustom.to);
    }
    fetch(`/api/marketing-analytics/dashboard?${params.toString()}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(d => { setData(d); setLoading(false); })
      .catch(() => { setLoadError(true); setLoading(false); });
  }, [period, appliedCustom, reloadToken]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#233653]">Marketing Performance</h1>
        <p className="text-sm text-gray-500 mt-1">Track marketing spend, customer acquisition, sales and store conversion.</p>
      </div>

      {/* Period filter */}
      <div className="flex flex-col gap-2">
        <div className="flex gap-1.5 flex-wrap">
          {PERIOD_OPTIONS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setPeriod(key)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                period === key ? 'bg-[#233653] text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {period === 'custom' && (
          <div className="flex items-center flex-wrap gap-2">
            <input type="date" value={customFrom} max={customTo} onChange={e => setCustomFrom(e.target.value)} className="text-xs border border-gray-200 rounded-md px-2 py-1.5" />
            <span className="text-gray-300 text-xs">to</span>
            <input type="date" value={customTo} min={customFrom} max={todayISO()} onChange={e => setCustomTo(e.target.value)} className="text-xs border border-gray-200 rounded-md px-2 py-1.5" />
            <button
              onClick={() => setAppliedCustom({ from: customFrom, to: customTo })}
              className="text-xs font-semibold text-white bg-[#233653] hover:bg-[#1b2941] rounded-md px-3 py-1.5"
            >
              Apply
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="text-center py-20 text-sm text-gray-400">Loading marketing performance…</div>
      ) : loadError || !data ? (
        <div className="text-center py-20">
          <p className="text-sm text-red-500 mb-3">Couldn't load marketing performance. Check your connection and try again.</p>
          <button onClick={() => setReloadToken(t => t + 1)} className="btn-secondary">Retry</button>
        </div>
      ) : (
        <DashboardBody data={data} />
      )}
    </div>
  );
}

function DashboardBody({ data }: { data: DashboardResponse }) {
  const { kpis, changes, chart, dailyRows } = data;

  return (
    <>
      {/* Row 1 — primary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon={<Megaphone size={18} className="text-[#233653]" />} bg="bg-[#EEF1F6]" label="Marketing Spend" value={money(kpis.marketing_spend)} change={changes.marketing_spend} goodDirection="neutral" />
        <KpiCard icon={<TrendingUp size={18} className="text-[#B68B3C]" />} bg="bg-[#FBF3E2]" label="Gross Sales" value={money(kpis.gross_sales)} change={changes.gross_sales} goodDirection="up" />
        <KpiCard icon={<Users size={18} className="text-[#233653]" />} bg="bg-[#EEF1F6]" label="Total Buyers" value={kpis.total_buyers.toLocaleString()} change={changes.total_buyers} goodDirection="up" />
        <KpiCard icon={<Footprints size={18} className="text-[#233653]" />} bg="bg-[#EEF1F6]" label="Store Visits" value={kpis.store_visits.toLocaleString()} change={changes.store_visits} goodDirection="up" />
      </div>

      {/* Row 2 — secondary/ratio KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon={<Target size={18} className="text-[#B8452E]" />} bg="bg-red-50" label="CAC" value={money(kpis.cac)} change={changes.cac} goodDirection="down" />
        <KpiCard icon={<Percent size={18} className="text-[#233653]" />} bg="bg-[#EEF1F6]" label="Conversion Rate" value={pctStr(kpis.conversion_rate)} change={changes.conversion_rate} goodDirection="up" />
        <KpiCard icon={<Gauge size={18} className="text-[#B68B3C]" />} bg="bg-[#FBF3E2]" label="ROAS" value={timesStr(kpis.roas)} change={changes.roas} goodDirection="up" />
        <KpiCard icon={<Wallet size={18} className="text-[#233653]" />} bg="bg-[#EEF1F6]" label="Avg. Spend / Buyer" value={money(kpis.avg_spend_per_buyer)} change={changes.avg_spend_per_buyer} goodDirection="up" />
      </div>

      {/* Funnel */}
      <div className="card">
        <p className="text-sm font-semibold text-gray-800 mb-4">Store Visits → Buyers Funnel</p>
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <FunnelStep label="Store Visits" value={kpis.store_visits.toLocaleString()} tone="light" />
          <FunnelArrow />
          <FunnelStep label="Buyers" value={kpis.total_buyers.toLocaleString()} tone="light" />
          <FunnelArrow />
          <FunnelStep label="Conversion Rate" value={pctStr(kpis.conversion_rate)} tone="gold" />
        </div>
        <p className="text-xs text-gray-400 text-center mt-4">
          {kpis.conversion_rate == null
            ? 'No store visits logged for this period yet — add a Daily Record to see conversion.'
            : kpis.conversion_rate < 15
              ? 'Conversion is on the lower side — the gap looks more like a traffic-to-buyer problem than a traffic problem.'
              : 'Traffic is converting reasonably well into buyers for the selected period.'}
        </p>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <p className="text-sm font-semibold text-gray-800 mb-3">Marketing Spend vs Gross Sales</p>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={chart} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} />
              <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} tickFormatter={(v) => moneyWhole(v)} width={70} />
              <Tooltip formatter={(val: number) => formatCurrency(val)} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="marketing_spend" name="Marketing Spend" stroke="#9CA3AF" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="gross_sales" name="Gross Sales" stroke="#B68B3C" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <p className="text-sm font-semibold text-gray-800 mb-3">Store Visits vs Buyers</p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chart} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} />
              <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="store_visits" name="Store Visits" fill="#D9DEE7" radius={[4, 4, 0, 0]} maxBarSize={36} />
              <Bar dataKey="total_buyers" name="Buyers" fill="#233653" radius={[4, 4, 0, 0]} maxBarSize={36} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <DailyTable rows={dailyRows} />
    </>
  );
}

function KpiCard({ icon, bg, label, value, change, goodDirection }: {
  icon: React.ReactNode; bg: string; label: string; value: string;
  change: number | null; goodDirection: 'up' | 'down' | 'neutral';
}) {
  // Marketing Spend has no inherent "good" direction (it's a cost input,
  // not an outcome) — the brief only assigns up/down-is-good meaning to
  // CAC and the five outcome metrics, so spend's badge stays neutral gray
  // rather than implying "spent more" is a win.
  const isGood = goodDirection === 'neutral' || change == null ? null : (goodDirection === 'up' ? change > 0 : change < 0);
  return (
    <div className="card flex items-center gap-3">
      <div className={`p-2.5 rounded-xl ${bg} shrink-0`}>{icon}</div>
      <div className="min-w-0">
        <p className="text-[11px] text-gray-500 font-medium">{label}</p>
        <p className="text-lg font-bold text-gray-900 truncate">{value}</p>
        {change != null && (
          <p className={`text-[11px] font-semibold flex items-center gap-0.5 mt-0.5 ${isGood == null ? 'text-gray-400' : isGood ? 'text-green-600' : 'text-red-500'}`}>
            {change >= 0 ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
            {Math.abs(change).toFixed(1)}% vs previous period
          </p>
        )}
      </div>
    </div>
  );
}

function FunnelStep({ label, value, tone }: { label: string; value: string; tone: 'light' | 'gold' }) {
  return (
    <div className={`rounded-xl px-6 py-4 text-center min-w-[140px] ${tone === 'gold' ? 'bg-[#FBF3E2] border border-[#E9DFC7]' : 'bg-[#F6F7F9] border border-gray-100'}`}>
      <p className={`text-xl font-bold ${tone === 'gold' ? 'text-[#B68B3C]' : 'text-[#233653]'}`}>{value}</p>
      <p className="text-[11px] text-gray-500 font-medium mt-0.5 uppercase tracking-wide">{label}</p>
    </div>
  );
}

function FunnelArrow() {
  return <div className="text-gray-300 text-xl font-light">→</div>;
}

type SortKey = keyof DailyRow;

function DailyTable({ rows }: { rows: DailyRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('entry_date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const exportCSV = () => {
    const headers = ['Date', 'Marketing Spend', 'Gross Sales', 'Total Buyers', 'New Customers', 'CAC', 'Store Visits', 'Conversion Rate', 'ROAS', 'Avg Spend/Buyer'];
    const csvRows = sorted.map(r => {
      const cac = computeCAC(r.marketing_spend, r.new_customers);
      const conv = computeConversionRate(r.total_buyers, r.store_visits);
      const roas = computeROAS(r.gross_sales, r.marketing_spend);
      const avg = computeAvgSpendPerBuyer(r.gross_sales, r.total_buyers);
      return [
        r.entry_date, r.marketing_spend.toFixed(2), r.gross_sales.toFixed(2), r.total_buyers, r.new_customers,
        cac == null ? '' : cac.toFixed(2), r.store_visits, conv == null ? '' : conv.toFixed(2),
        roas == null ? '' : roas.toFixed(2), avg == null ? '' : avg.toFixed(2),
      ];
    });
    const csv = [headers, ...csvRows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `marketing-performance-${todayISO()}.csv`;
    a.click();
  };

  const cols: { key: SortKey; label: string }[] = [
    { key: 'entry_date', label: 'Date' },
    { key: 'marketing_spend', label: 'Spend' },
    { key: 'gross_sales', label: 'Sales' },
    { key: 'total_buyers', label: 'Buyers' },
    { key: 'new_customers', label: 'New Customers' },
    { key: 'store_visits', label: 'Visits' },
  ];

  return (
    <div className="card p-0 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <p className="text-sm font-semibold text-gray-800">Daily Performance</p>
        <button onClick={exportCSV} className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-800">
          <Download size={13} /> Export CSV
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-12">No records in this period yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                {cols.map(c => (
                  <th key={c.key} className="px-4 py-3 font-medium whitespace-nowrap cursor-pointer select-none hover:text-gray-700" onClick={() => toggleSort(c.key)}>
                    <span className="inline-flex items-center gap-1">{c.label} <ArrowUpDown size={11} className={sortKey === c.key ? 'text-[#233653]' : 'text-gray-300'} /></span>
                  </th>
                ))}
                <th className="px-4 py-3 font-medium whitespace-nowrap">CAC</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">Conversion</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">ROAS</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">Avg. Spend/Buyer</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sorted.map(r => (
                <tr key={r.entry_date} className="hover:bg-gray-50/60">
                  <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{formatDate(r.entry_date)}</td>
                  <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{formatCurrency(r.marketing_spend)}</td>
                  <td className="px-4 py-3 font-semibold text-gray-900 whitespace-nowrap">{formatCurrency(r.gross_sales)}</td>
                  <td className="px-4 py-3 text-gray-700">{r.total_buyers.toLocaleString()}</td>
                  <td className="px-4 py-3 text-gray-700">{r.new_customers.toLocaleString()}</td>
                  <td className="px-4 py-3 text-gray-700">{r.store_visits.toLocaleString()}</td>
                  <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{money(computeCAC(r.marketing_spend, r.new_customers))}</td>
                  <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{pctStr(computeConversionRate(r.total_buyers, r.store_visits))}</td>
                  <td className="px-4 py-3 text-[#B68B3C] font-semibold whitespace-nowrap">{timesStr(computeROAS(r.gross_sales, r.marketing_spend))}</td>
                  <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{money(computeAvgSpendPerBuyer(r.gross_sales, r.total_buyers))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
