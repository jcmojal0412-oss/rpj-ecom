'use client';

import { useEffect, useState, useCallback } from 'react';
import { Package, TrendingUp, TrendingDown, DollarSign, AlertTriangle, Download, Trophy } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import MovingChart from './MovingChart';
import Spinner from '@/components/ui/Spinner';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

interface KPIs {
  inventoryValue: number;
  totalSkus: number;
  todayIn: number;
  todayOut: number;
}

interface LowStockItem {
  id: number; sku: string; name: string; quantity: number; reorder_point: number;
}

interface SummaryRow {
  sku: string; name: string; cogs: number;
  opening_stock: number; stock_in: number; stock_out: number;
  remaining: number; inventory_value: number;
}

interface ChartItem { sku: string; name: string; total_out: number; }
interface DailyItem  { sku: string; name: string; total_out: number; total_in: number; }
type DailyPeriod = 'today' | 'yesterday' | '7days';

export default function DashboardClient() {
  const [kpis, setKpis] = useState<KPIs | null>(null);
  const [lowStock, setLowStock] = useState<LowStockItem[]>([]);
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [fast,        setFast]        = useState<ChartItem[]>([]);
  const [slow,        setSlow]        = useState<ChartItem[]>([]);
  const [dailyTop,    setDailyTop]    = useState<DailyItem[]>([]);
  const [dailyLabel,  setDailyLabel]  = useState('');
  const [dailyPeriod, setDailyPeriod] = useState<DailyPeriod>('today');
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [k, ls, s, f, sl, dt] = await Promise.all([
      fetch('/api/dashboard/kpis').then(r => r.json()),
      fetch('/api/inventory?low_stock=1').then(r => r.json()),
      fetch('/api/inventory/summary').then(r => r.json()),
      fetch('/api/dashboard/fast-moving').then(r => r.json()),
      fetch('/api/dashboard/slow-moving').then(r => r.json()),
      fetch(`/api/dashboard/daily-top?period=${dailyPeriod}`).then(r => r.json()),
    ]);
    setKpis(k);
    setLowStock(ls);
    setSummary(s);
    setFast(f);
    setSlow(sl);
    setDailyTop(dt.rows ?? []);
    setDailyLabel(dt.label ?? '');
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

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
    a.download = `rpj-summary-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  };

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <Spinner size={36} />
    </div>
  );

  const totalInvValue = summary.reduce((s, r) => s + r.inventory_value, 0);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">CEO Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">
          {new Date().toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard
          title="Total Inventory Value"
          value={formatCurrency(kpis?.inventoryValue ?? 0)}
          icon={<DollarSign className="text-orange-500" size={22} />}
          color="blue"
        />
        <KpiCard
          title="Total SKUs"
          value={String(kpis?.totalSkus ?? 0)}
          icon={<Package className="text-orange-500" size={22} />}
          color="blue"
        />
        <KpiCard
          title="Today's Stock In"
          value={String(kpis?.todayIn ?? 0)} unit="units"
          icon={<TrendingUp className="text-green-600" size={22} />}
          color="green"
        />
        <KpiCard
          title="Today's Stock Out"
          value={String(kpis?.todayOut ?? 0)} unit="units"
          icon={<TrendingDown className="text-red-500" size={22} />}
          color="red"
        />
      </div>

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
        <MovingChart title="Slow Moving / Dead Stock — Bottom 10 (Last 30 Days)" data={slow} color="#d97706" />
      </div>

      {/* Low Stock Alerts */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle className="text-red-600" size={20} />
          <h2 className="text-base font-semibold text-gray-900">
            Low Stock Alerts
            <span className="ml-2 inline-flex items-center justify-center w-6 h-6 rounded-full bg-red-600 text-white text-xs font-bold">
              {lowStock.length}
            </span>
          </h2>
        </div>
        {lowStock.length === 0 ? (
          <p className="text-sm text-gray-500">All products are at or above their reorder points.</p>
        ) : (
          <div className="space-y-2">
            {lowStock.map(item => (
              <div key={item.id} className="flex items-center justify-between border border-red-200 bg-red-50 rounded-lg px-4 py-3">
                <div className="flex items-center gap-4">
                  <span className="text-xs font-mono font-semibold text-red-700 bg-red-100 px-2 py-0.5 rounded">{item.sku}</span>
                  <span className="text-sm font-medium text-gray-900">{item.name}</span>
                </div>
                <div className="flex items-center gap-6 text-sm">
                  <span className="text-red-700 font-semibold">Current: {item.quantity}</span>
                  <span className="text-gray-500">Reorder at: {item.reorder_point}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Daily Summary */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-900">Daily Remaining Stock Summary</h2>
          <button onClick={exportCSV} className="btn-secondary text-xs">
            <Download size={14} /> Export CSV
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                {['SKU','Product Name','COGS','Opening','Stock In','Stock Out','Remaining','Inv. Value'].map(h => (
                  <th key={h} className="table-header">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {summary.map((row, i) => (
                <tr key={row.sku} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="table-cell font-mono text-xs font-semibold text-gray-600">{row.sku}</td>
                  <td className="table-cell font-medium">{row.name}</td>
                  <td className="table-cell">{formatCurrency(row.cogs)}</td>
                  <td className="table-cell text-right">{row.opening_stock}</td>
                  <td className="table-cell text-right text-green-700 font-medium">{row.stock_in > 0 ? `+${row.stock_in}` : 0}</td>
                  <td className="table-cell text-right text-red-600 font-medium">{row.stock_out > 0 ? `-${row.stock_out}` : 0}</td>
                  <td className="table-cell text-right font-semibold">{row.remaining}</td>
                  <td className="table-cell text-right">{formatCurrency(row.inventory_value)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-200 bg-gray-100 font-semibold">
                <td className="table-cell" colSpan={3}>TOTAL</td>
                <td className="table-cell text-right">{summary.reduce((s, r) => s + r.opening_stock, 0)}</td>
                <td className="table-cell text-right text-green-700">+{summary.reduce((s, r) => s + r.stock_in, 0)}</td>
                <td className="table-cell text-right text-red-600">-{summary.reduce((s, r) => s + r.stock_out, 0)}</td>
                <td className="table-cell text-right">{summary.reduce((s, r) => s + r.remaining, 0)}</td>
                <td className="table-cell text-right">{formatCurrency(totalInvValue)}</td>
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
    <div className="card">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Trophy className="text-orange-500" size={20} />
          <div>
            <h2 className="text-base font-semibold text-gray-900">Top 10 Products</h2>
            <p className="text-xs text-gray-400">{label} — ranked by units sold out</p>
          </div>
        </div>
        {/* Period filter buttons */}
        <div className="flex items-center bg-gray-100 rounded-lg p-1 gap-0.5">
          {(['today', 'yesterday', '7days'] as DailyPeriod[]).map(p => (
            <button
              key={p}
              onClick={() => onPeriodChange(p)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                period === p
                  ? 'bg-orange-500 text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {data.length === 0 ? (
        <div className="text-center py-10 text-gray-400 text-sm">
          No stock movements recorded for {PERIOD_LABELS[period].toLowerCase()} yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Chart */}
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#6b7280' }} angle={-35} textAnchor="end" interval={0} />
              <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} />
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
                  <p className="text-sm font-medium text-gray-900 truncate">{item.name}</p>
                  <p className="text-xs text-gray-400">{item.sku}</p>
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

function KpiCard({ title, value, unit, icon, color }: {
  title: string; value: string; unit?: string;
  icon: React.ReactNode; color: 'green' | 'blue' | 'red' | 'amber';
}) {
  const bg = { green: 'bg-green-50', blue: 'bg-blue-50', red: 'bg-red-50', amber: 'bg-amber-50' }[color];
  return (
    <div className="card flex items-center gap-4">
      <div className={`p-3 rounded-xl ${bg}`}>{icon}</div>
      <div>
        <p className="text-xs text-gray-500 font-medium">{title}</p>
        <p className="text-2xl font-bold text-gray-900 mt-0.5">
          {value}{unit && <span className="text-sm font-normal text-gray-500 ml-1">{unit}</span>}
        </p>
      </div>
    </div>
  );
}
