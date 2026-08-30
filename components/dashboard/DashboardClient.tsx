'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  Package, TrendingUp, TrendingDown, BadgeDollarSign, Landmark,
  AlertTriangle, ClipboardList, Wrench, Users, ChevronRight,
  Download, Trophy, ArrowUp, ArrowDown,
} from 'lucide-react';
import { formatCurrency, todayISO } from '@/lib/utils';
import { resolvePeriod, pctChange, PERIOD_OPTIONS, type PeriodKey } from '@/lib/marketing-analytics';
import MovingChart from './MovingChart';
import Spinner from '@/components/ui/Spinner';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

interface KPIs {
  inventoryValue: number;
  totalSkus: number;
  stockIn: number;
  stockOut: number;
  prevStockIn: number | null;
  prevStockOut: number | null;
}

interface FinancingSummary { available: boolean; total: number; prevTotal: number | null; }

interface LowStockItem {
  id: number; sku: string; name: string; quantity: number; reorder_point: number;
}

interface SummaryRow {
  sku: string; name: string; cogs: number;
  opening_stock: number; stock_in: number; stock_out: number;
  remaining: number; inventory_value: number;
}

interface ChartItem { sku: string; name: string; total_out: number; quantity?: number; }
interface DailyItem  { sku: string; name: string; total_out: number; total_in: number; }
type DailyPeriod = 'today' | 'yesterday' | '7days';

interface AttentionItem { key: string; title: string; count: number; unit: string; href: string; }

const ATTENTION_ICON: Record<string, React.ElementType> = {
  low_stock: AlertTriangle,
  pending_po: ClipboardList,
  service_center: Wrench,
  hr: Users,
};

export default function DashboardClient() {
  const [kpis, setKpis] = useState<KPIs | null>(null);
  const [financing, setFinancing] = useState<FinancingSummary | null>(null);
  const [attention, setAttention] = useState<AttentionItem[]>([]);
  const [attentionLoaded, setAttentionLoaded] = useState(false);
  const [lowStock, setLowStock] = useState<LowStockItem[]>([]);
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [fast,        setFast]        = useState<ChartItem[]>([]);
  const [slow,        setSlow]        = useState<ChartItem[]>([]);
  const [dailyTop,    setDailyTop]    = useState<DailyItem[]>([]);
  const [dailyLabel,  setDailyLabel]  = useState('');
  const [dailyPeriod, setDailyPeriod] = useState<DailyPeriod>('today');
  const [loading, setLoading] = useState(true);
  const [kpiLoading, setKpiLoading] = useState(true);

  // Global period filter — drives Stock In / Stock Out / Financing Sales.
  // Inventory Value and Total SKUs stay current-state (not date-ranged).
  const [period, setPeriod] = useState<PeriodKey>('today');
  const [customFrom, setCustomFrom] = useState(todayISO());
  const [customTo, setCustomTo] = useState(todayISO());
  const [appliedCustom, setAppliedCustom] = useState({ from: todayISO(), to: todayISO() });

  const range = useMemo(
    () => resolvePeriod(period, todayISO(), appliedCustom.from, appliedCustom.to),
    [period, appliedCustom]
  );

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [ls, s, f, sl, dt] = await Promise.all([
      fetch('/api/inventory?low_stock=1').then(r => r.json()),
      fetch('/api/inventory/summary').then(r => r.json()),
      fetch('/api/dashboard/fast-moving').then(r => r.json()),
      fetch('/api/dashboard/slow-moving').then(r => r.json()),
      fetch(`/api/dashboard/daily-top?period=${dailyPeriod}`).then(r => r.json()),
    ]);
    setLowStock(ls);
    setSummary(s);
    setFast(f);
    setSlow(sl);
    setDailyTop(dt.rows ?? []);
    setDailyLabel(dt.label ?? '');
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    fetch('/api/dashboard/attention').then(r => r.json()).then(d => {
      setAttention(d.items ?? []);
      setAttentionLoaded(true);
    }).catch(() => setAttentionLoaded(true));
  }, []);

  const fetchPeriodKpis = useCallback(async (from: string, to: string, prevFrom: string, prevTo: string) => {
    setKpiLoading(true);
    const params = new URLSearchParams({ from, to, prevFrom, prevTo });
    // Each fetch has its own fallback so a network failure on either call
    // can't leave kpiLoading stuck true forever (Promise.all would otherwise
    // reject as a whole and skip the setKpiLoading(false) below).
    const [k, fin] = await Promise.all([
      fetch(`/api/dashboard/kpis?${params}`).then(r => r.json())
        .catch(() => ({ inventoryValue: 0, totalSkus: 0, stockIn: 0, stockOut: 0, prevStockIn: null, prevStockOut: null })),
      fetch(`/api/dashboard/financing-summary?${params}`).then(r => r.json())
        .catch(() => ({ available: false, total: 0, prevTotal: null })),
    ]);
    setKpis(k);
    setFinancing(fin);
    setKpiLoading(false);
  }, []);

  useEffect(() => {
    fetchPeriodKpis(range.from, range.to, range.prevFrom, range.prevTo);
  }, [range, fetchPeriodKpis]);

  const fetchDailyTop = useCallback(async (period: DailyPeriod) => {
    const dt = await fetch(`/api/dashboard/daily-top?period=${period}`).then(r => r.json());
    setDailyTop(dt.rows ?? []);
    setDailyLabel(dt.label ?? '');
  }, []);

  const handlePeriodChange = (period: DailyPeriod) => {
    setDailyPeriod(period);
    fetchDailyTop(period);
  };

  const exportCSV = () => {
    const headers = ['SKU', 'Product Name', 'COGS', 'Opening Stock', 'Stock In', 'Stock Out', 'Remaining', 'Inventory Value'];
    const rows = summary.map(r => [
      r.sku, r.name, r.cogs, r.opening_stock, r.stock_in, r.stock_out, r.remaining, r.inventory_value.toFixed(2)
    ]);
    const totals = ['TOTAL', '', '',
      summary.reduce((s, r) => s + r.opening_stock, 0),
      summary.reduce((s, r) => s + r.stock_in, 0),
      summary.reduce((s, r) => s + r.stock_out, 0),
      summary.reduce((s, r) => s + r.remaining, 0),
      summary.reduce((s, r) => s + r.inventory_value, 0).toFixed(2),
    ];
    const csv = [headers, ...rows, totals].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `rpj-summary-${todayISO()}.csv`;
    a.click();
  };

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <Spinner size={36} />
    </div>
  );

  const totalInvValue = summary.reduce((s, r) => s + r.inventory_value, 0);
  const stockInChange  = kpis && kpis.prevStockIn  != null ? pctChange(kpis.stockIn,  kpis.prevStockIn)  : null;
  const stockOutChange = kpis && kpis.prevStockOut != null ? pctChange(kpis.stockOut, kpis.prevStockOut) : null;
  const financingChange = financing && financing.prevTotal != null ? pctChange(financing.total, financing.prevTotal) : null;

  const showFinancingCard = financing == null || financing.available;
  const kpiGridCols = showFinancingCard
    ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5'
    : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4';

  return (
    <div className="min-h-screen bg-[#F6F8FC] p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-[28px] font-bold text-[#16233B]">Operations Dashboard</h1>
          <p className="text-sm text-[#66758A] mt-1">
            {new Date().toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
          <select
            value={period}
            onChange={e => setPeriod(e.target.value as PeriodKey)}
            className="text-sm border border-[#E5EAF0] rounded-lg px-3 py-2.5 bg-white text-[#16233B] focus:outline-none focus:ring-1 focus:ring-[#B68B3C]"
          >
            {PERIOD_OPTIONS.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
          </select>
          {period === 'custom' && (
            <div className="flex items-center flex-wrap gap-2">
              <input type="date" value={customFrom} max={customTo} onChange={e => setCustomFrom(e.target.value)} className="text-xs border border-[#E5EAF0] rounded-md px-2 py-1.5" />
              <span className="text-[#B7C0CC] text-xs">to</span>
              <input type="date" value={customTo} min={customFrom} max={todayISO()} onChange={e => setCustomTo(e.target.value)} className="text-xs border border-[#E5EAF0] rounded-md px-2 py-1.5" />
              <button
                onClick={() => setAppliedCustom({ from: customFrom, to: customTo })}
                className="text-xs font-semibold text-white bg-[#233653] hover:bg-[#1b2941] rounded-md px-3 py-1.5"
              >
                Apply
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Business Snapshot */}
      <div>
        <h2 className="text-sm font-semibold text-[#16233B]">Business Snapshot</h2>
        <p className="text-xs text-[#66758A] mt-0.5">Key operational metrics at a glance.</p>
      </div>

      {/* KPI Cards */}
      <div className={`grid ${kpiGridCols} gap-4`}>
        <KpiCard
          label="Total Inventory Value"
          value={formatCurrency(kpis?.inventoryValue ?? 0)}
          icon={BadgeDollarSign} iconColor="#B68B3C" iconBg="#FBF3E2"
          loading={kpiLoading}
        />
        <KpiCard
          label="Total SKUs"
          value={String(kpis?.totalSkus ?? 0)}
          icon={Package} iconColor="#66758A" iconBg="#F0F3F8"
          loading={kpiLoading}
        />
        <KpiCard
          label="Stock In"
          value={String(kpis?.stockIn ?? 0)} unit="units"
          icon={TrendingUp} iconColor="#15803D" iconBg="#EAF7EE"
          changePct={stockInChange}
          loading={kpiLoading}
        />
        <KpiCard
          label="Stock Out"
          value={String(kpis?.stockOut ?? 0)} unit="units"
          icon={TrendingDown} iconColor="#DC2626" iconBg="#FDEDED"
          changePct={stockOutChange}
          loading={kpiLoading}
        />
        {showFinancingCard && (
          <KpiCard
            label="Financing Sales"
            value={formatCurrency(financing?.total ?? 0)}
            icon={Landmark} iconColor="#233653" iconBg="#E7EBF2"
            changePct={financingChange}
            loading={kpiLoading || financing == null}
          />
        )}
      </div>

      {/* Attention Needed */}
      {attentionLoaded && (
        <div className="bg-white border border-[#E5EAF0] rounded-xl p-5 sm:p-6">
          <h2 className="text-sm font-semibold text-[#16233B] mb-1">Attention Needed</h2>
          <p className="text-xs text-[#66758A] mb-4">Items that may require action.</p>
          {attention.length === 0 ? (
            <p className="text-sm text-[#66758A]">✅ Nothing needs your attention right now.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {attention.map(item => {
                const Icon = ATTENTION_ICON[item.key] ?? AlertTriangle;
                return (
                  <Link
                    key={item.key}
                    href={item.href}
                    className="flex items-center gap-3 bg-white border border-[#E5EAF0] rounded-lg px-4 py-3 hover:border-[#B68B3C] transition-colors group"
                  >
                    <div className="p-2 rounded-lg bg-[#FBF3E2] shrink-0">
                      <Icon size={17} className="text-[#B68B3C]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-[#16233B]">{item.title}</p>
                      <p className="text-xs text-[#66758A]">{item.count} {item.unit}</p>
                    </div>
                    <ChevronRight size={16} className="text-[#B7C0CC] group-hover:text-[#B68B3C] shrink-0" />
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Daily Top 10 */}
      <DailyTopSection
        data={dailyTop}
        label={dailyLabel}
        period={dailyPeriod}
        onPeriodChange={handlePeriodChange}
      />

      {/* Charts */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <MovingChart title="Fast Moving — Top 10 (Last 30 Days)" data={fast} color="#16a34a" />
        <MovingChart title="Slow Moving / Dead Stock — Bottom 10 (Last 30 Days)" data={slow} color="#B68B3C" />
      </div>

      {/* Low Stock Alerts */}
      <div className="bg-white border border-[#E5EAF0] rounded-xl p-5 sm:p-6">
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle className="text-red-600" size={20} />
          <h2 className="text-base font-semibold text-[#16233B]">
            Stock Alerts
            <span className="ml-2 inline-flex items-center justify-center w-6 h-6 rounded-full bg-red-600 text-white text-xs font-bold">
              {lowStock.length}
            </span>
          </h2>
          <span className="text-xs text-[#94A2B4] ml-1">Top 10 most urgent</span>
        </div>
        {lowStock.length === 0 ? (
          <p className="text-sm text-[#66758A]">✅ All products are at healthy stock levels.</p>
        ) : (
          <div className="space-y-2">
            {lowStock.map(item => {
              const isCritical = item.quantity <= item.reorder_point;
              const isOut      = item.quantity <= 0;
              const pct        = item.reorder_point > 0 ? Math.min(100, (item.quantity / (item.reorder_point * 2)) * 100) : 0;

              const borderColor = isOut ? 'border-red-400 bg-red-50'
                : isCritical ? 'border-orange-300 bg-orange-50'
                : 'border-amber-200 bg-amber-50';

              const badge = isOut ? (
                <span className="text-xs font-bold text-white bg-red-600 px-2 py-0.5 rounded-full">OUT</span>
              ) : isCritical ? (
                <span className="text-xs font-bold text-white bg-orange-500 px-2 py-0.5 rounded-full">LOW</span>
              ) : (
                <span className="text-xs font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">WATCH</span>
              );

              return (
                <div key={item.id} className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-0 border rounded-lg px-4 py-3 ${borderColor}`}>
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <span className="text-xs font-mono font-semibold text-[#66758A] bg-white/70 px-2 py-0.5 rounded shrink-0">
                      {item.sku}
                    </span>
                    <span className="text-sm font-medium text-[#16233B] truncate">{item.name}</span>
                    {badge}
                  </div>
                  <div className="flex items-center gap-4 text-sm shrink-0 sm:ml-4">
                    <div className="text-right">
                      <p className={`font-bold ${isOut ? 'text-red-700' : isCritical ? 'text-orange-700' : 'text-amber-700'}`}>
                        {item.quantity} units
                      </p>
                      <div className="w-20 bg-gray-200 rounded-full h-1.5 mt-1">
                        <div
                          className={`h-1.5 rounded-full ${isOut ? 'bg-red-500' : isCritical ? 'bg-orange-500' : 'bg-amber-400'}`}
                          style={{ width: `${Math.max(0, pct)}%` }}
                        />
                      </div>
                    </div>
                    <span className="text-[#94A2B4] text-xs">min: {item.reorder_point}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Daily Summary */}
      <div className="bg-white border border-[#E5EAF0] rounded-xl p-5 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-[#16233B]">Daily Remaining Stock Summary</h2>
          <button
            onClick={exportCSV}
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-white border border-[#E5EAF0] text-[#16233B] text-xs font-medium rounded-lg hover:bg-[#F6F8FC] transition-colors"
          >
            <Download size={14} className="text-[#66758A]" /> Export CSV
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E5EAF0]">
                {['SKU','Product Name','COGS','Opening','Stock In','Stock Out','Remaining','Inv. Value'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-[#66758A] uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {summary.map((row, i) => (
                <tr key={row.sku} className={i % 2 === 0 ? 'bg-white' : 'bg-[#F6F8FC]'}>
                  <td className="px-4 py-3 text-sm font-mono text-xs font-semibold text-[#66758A]">{row.sku}</td>
                  <td className="px-4 py-3 text-sm font-medium text-[#16233B]">{row.name}</td>
                  <td className="px-4 py-3 text-sm text-[#16233B]">{formatCurrency(row.cogs)}</td>
                  <td className="px-4 py-3 text-sm text-right text-[#16233B]">{row.opening_stock}</td>
                  <td className="px-4 py-3 text-sm text-right text-green-700 font-medium">{row.stock_in > 0 ? `+${row.stock_in}` : 0}</td>
                  <td className="px-4 py-3 text-sm text-right text-red-600 font-medium">{row.stock_out > 0 ? `-${row.stock_out}` : 0}</td>
                  <td className="px-4 py-3 text-sm text-right font-semibold text-[#16233B]">{row.remaining}</td>
                  <td className="px-4 py-3 text-sm text-right text-[#16233B] whitespace-nowrap">{formatCurrency(row.inventory_value)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-[#E5EAF0] bg-[#F6F8FC] font-semibold">
                <td className="px-4 py-3 text-sm text-[#16233B]" colSpan={3}>TOTAL</td>
                <td className="px-4 py-3 text-sm text-right text-[#16233B]">{summary.reduce((s, r) => s + r.opening_stock, 0)}</td>
                <td className="px-4 py-3 text-sm text-right text-green-700">+{summary.reduce((s, r) => s + r.stock_in, 0)}</td>
                <td className="px-4 py-3 text-sm text-right text-red-600">-{summary.reduce((s, r) => s + r.stock_out, 0)}</td>
                <td className="px-4 py-3 text-sm text-right text-[#16233B]">{summary.reduce((s, r) => s + r.remaining, 0)}</td>
                <td className="px-4 py-3 text-sm text-right text-[#16233B] whitespace-nowrap">{formatCurrency(totalInvValue)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

const RANK_COLORS = ['#f97316','#fb923c','#fdba74','#3b82f6','#60a5fa','#93c5fd','#22c55e','#4ade80','#86efac','#d1d5db'];

const PERIOD_LABELS: Record<string, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  '7days': 'Last 7 Days',
};

function DailyTopSection({ data, label, period, onPeriodChange }: {
  data: { sku: string; name: string; total_out: number; total_in: number }[];
  label: string;
  period: DailyPeriod;
  onPeriodChange: (p: DailyPeriod) => void;
}) {
  const chartData = data.map((d, i) => ({
    rank: `#${i + 1}`,
    name: d.name.length > 14 ? d.name.slice(0, 14) + '…' : d.name,
    fullName: d.name,
    out: d.total_out,
    in: d.total_in,
  }));

  return (
    <div className="bg-white border border-[#E5EAF0] rounded-xl p-5 sm:p-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Trophy className="text-[#B68B3C]" size={20} />
          <div>
            <h2 className="text-base font-semibold text-[#16233B]">Top 10 Products</h2>
            <p className="text-xs text-[#94A2B4]">{label} — ranked by units sold out</p>
          </div>
        </div>
        {/* Period filter buttons */}
        <div className="flex items-center bg-[#F0F3F8] rounded-lg p-1 gap-0.5">
          {(['today', 'yesterday', '7days'] as DailyPeriod[]).map(p => (
            <button
              key={p}
              onClick={() => onPeriodChange(p)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                period === p
                  ? 'bg-[#233653] text-white'
                  : 'text-[#66758A] hover:text-[#16233B]'
              }`}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {data.length === 0 ? (
        <div className="text-center py-10 text-[#94A2B4] text-sm">
          No stock movements recorded for {PERIOD_LABELS[period].toLowerCase()} yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Chart */}
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#66758A' }} angle={-35} textAnchor="end" interval={0} />
              <YAxis tick={{ fontSize: 11, fill: '#66758A' }} />
              <Tooltip
                formatter={(val: number, name: string) => [val, name === 'out' ? 'Stock Out' : 'Stock In']}
                labelFormatter={(label: string) => {
                  const item = chartData.find(d => d.name === label);
                  return item ? item.fullName : label;
                }}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
              <Bar dataKey="out" name="Stock Out" radius={[4,4,0,0]} maxBarSize={40}>
                {chartData.map((_, i) => <Cell key={i} fill={RANK_COLORS[i] ?? '#94a3b8'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          {/* Ranking Table */}
          <div className="space-y-2">
            {data.map((item, i) => (
              <div key={item.sku} className="flex items-center gap-3">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0`}
                  style={{ backgroundColor: RANK_COLORS[i] ?? '#94a3b8' }}>
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#16233B] truncate">{item.name}</p>
                  <p className="text-xs text-[#94A2B4]">{item.sku}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-red-600">{item.total_out} out</p>
                  {item.total_in > 0 && <p className="text-xs text-green-600">+{item.total_in} in</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function KpiCard({ label, value, unit, icon: Icon, iconColor, iconBg, changePct, loading }: {
  label: string; value: string; unit?: string;
  icon: React.ElementType; iconColor: string; iconBg: string;
  changePct?: number | null; loading?: boolean;
}) {
  return (
    <div className="bg-white border border-[#E5EAF0] rounded-xl p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className="p-2 rounded-lg shrink-0" style={{ backgroundColor: iconBg }}>
          <Icon size={18} style={{ color: iconColor }} />
        </div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#66758A] leading-snug">{label}</p>
      </div>
      <p className="text-xl sm:text-2xl font-bold text-[#16233B] whitespace-nowrap">
        {loading ? '…' : value}{unit && <span className="text-sm font-normal text-[#66758A] ml-1">{unit}</span>}
      </p>
      {!loading && changePct != null && (
        <div className={`flex items-center gap-1 mt-1.5 text-xs font-semibold ${changePct >= 0 ? 'text-green-600' : 'text-red-500'}`}>
          {changePct >= 0 ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
          {Math.abs(changePct).toFixed(1)}% vs previous period
        </div>
      )}
    </div>
  );
}
