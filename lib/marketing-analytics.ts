// Pure calculation + date-range logic for the Marketing Analytics module.
// No DB/network access here — keeps the KPI math and period resolution
// independently testable and reused identically by both the dashboard API
// route and (for validation messaging) the Daily Records form.

export type PeriodKey =
  | 'today' | 'yesterday'
  | 'this_week' | 'last_week'
  | 'this_month' | 'last_month'
  | 'last_3_months' | '1_year'
  | 'custom';

export const PERIOD_OPTIONS: { key: PeriodKey; label: string }[] = [
  { key: 'today',         label: 'Today' },
  { key: 'yesterday',     label: 'Yesterday' },
  { key: 'this_week',     label: 'This Week' },
  { key: 'last_week',     label: 'Last Week' },
  { key: 'this_month',    label: 'This Month' },
  { key: 'last_month',    label: 'Last Month' },
  { key: 'last_3_months', label: 'Last 3 Months' },
  { key: '1_year',        label: '1 Year' },
  { key: 'custom',        label: 'Custom Range' },
];

export interface PeriodRange {
  from: string; to: string;
  prevFrom: string; prevTo: string;
  granularity: 'day' | 'week' | 'month';
}

function isoToUTC(iso: string): Date {
  return new Date(iso + 'T00:00:00Z');
}
function utcToISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDaysISO(iso: string, days: number): string {
  const d = isoToUTC(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return utcToISO(d);
}
function addMonthsISO(iso: string, months: number): string {
  const d = isoToUTC(iso);
  const nd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate()));
  return utcToISO(nd);
}
function startOfWeekMondayISO(iso: string): string {
  const d = isoToUTC(iso);
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return utcToISO(d);
}
function startOfMonthISO(iso: string): string {
  const d = isoToUTC(iso);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}
function endOfMonthISO(iso: string): string {
  const d = isoToUTC(iso);
  const nextMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  nextMonth.setUTCDate(nextMonth.getUTCDate() - 1);
  return utcToISO(nextMonth);
}
// Inclusive day count between two ISO dates.
function daysBetween(fromISO: string, toISO: string): number {
  return Math.round((isoToUTC(toISO).getTime() - isoToUTC(fromISO).getTime()) / 86400000) + 1;
}

function granularityForRange(fromISO: string, toISO: string): 'day' | 'week' | 'month' {
  const n = daysBetween(fromISO, toISO);
  if (n <= 31) return 'day';
  if (n <= 120) return 'week';
  return 'month';
}

// Resolves a preset (or custom) period into a concrete date range, plus the
// immediately-preceding period of matching length for the "vs previous
// period" comparison. `today` is injected (not read from Date.now() here)
// so this stays a pure, testable function — callers pass todayISO().
export function resolvePeriod(key: PeriodKey, today: string, customFrom?: string, customTo?: string): PeriodRange {
  let from: string, to: string, prevFrom: string, prevTo: string;

  switch (key) {
    case 'today':
      from = to = today;
      prevFrom = prevTo = addDaysISO(today, -1);
      break;
    case 'yesterday':
      from = to = addDaysISO(today, -1);
      prevFrom = prevTo = addDaysISO(today, -2);
      break;
    case 'this_week': {
      from = startOfWeekMondayISO(today);
      to = today; // week-to-date
      const len = daysBetween(from, to);
      prevTo = addDaysISO(from, -1);
      prevFrom = addDaysISO(prevTo, -(len - 1));
      break;
    }
    case 'last_week': {
      const thisWeekStart = startOfWeekMondayISO(today);
      to = addDaysISO(thisWeekStart, -1);
      from = addDaysISO(to, -6);
      prevTo = addDaysISO(from, -1);
      prevFrom = addDaysISO(prevTo, -6);
      break;
    }
    case 'this_month': {
      from = startOfMonthISO(today);
      to = today; // month-to-date
      const dayIndex = daysBetween(from, to);
      const prevAnchor = addMonthsISO(from, -1);
      prevFrom = startOfMonthISO(prevAnchor);
      // Compare the same number of days into last month, so a month-to-date
      // total isn't unfairly measured against the whole of last month.
      prevTo = addDaysISO(prevFrom, dayIndex - 1);
      break;
    }
    case 'last_month': {
      const lastMonthAnchor = addMonthsISO(startOfMonthISO(today), -1);
      from = startOfMonthISO(lastMonthAnchor);
      to = endOfMonthISO(lastMonthAnchor);
      const prevAnchor = addMonthsISO(from, -1);
      prevFrom = startOfMonthISO(prevAnchor);
      prevTo = endOfMonthISO(prevAnchor);
      break;
    }
    case 'last_3_months': {
      to = today;
      from = addDaysISO(addMonthsISO(today, -3), 1);
      const len = daysBetween(from, to);
      prevTo = addDaysISO(from, -1);
      prevFrom = addDaysISO(prevTo, -(len - 1));
      break;
    }
    case '1_year': {
      to = today;
      from = addDaysISO(addMonthsISO(today, -12), 1);
      const len = daysBetween(from, to);
      prevTo = addDaysISO(from, -1);
      prevFrom = addDaysISO(prevTo, -(len - 1));
      break;
    }
    case 'custom': {
      from = customFrom || today;
      to = customTo || today;
      if (from > to) [from, to] = [to, from];
      const len = daysBetween(from, to);
      prevTo = addDaysISO(from, -1);
      prevFrom = addDaysISO(prevTo, -(len - 1));
      break;
    }
  }

  return { from, to, prevFrom, prevTo, granularity: granularityForRange(from, to) };
}

// ── KPI formulas ─────────────────────────────────────────────────────────
// Each returns null (rendered as "—") when the denominator makes the ratio
// meaningless, rather than Infinity/NaN.

export function computeCAC(marketingSpend: number, newCustomers: number): number | null {
  if (newCustomers <= 0) return null;
  return marketingSpend / newCustomers;
}

export function computeConversionRate(totalBuyers: number, storeVisits: number): number | null {
  if (storeVisits <= 0) return null;
  return (totalBuyers / storeVisits) * 100;
}

export function computeROAS(grossSales: number, marketingSpend: number): number | null {
  if (marketingSpend <= 0) return null;
  return grossSales / marketingSpend;
}

export function computeAvgSpendPerBuyer(grossSales: number, totalBuyers: number): number | null {
  if (totalBuyers <= 0) return null;
  return grossSales / totalBuyers;
}

// Percent change vs. a previous value. Null when the previous value is 0
// and current isn't (an "infinite"/undefined growth rate — the UI omits
// the comparison badge rather than showing a meaningless number).
export function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

// For CAC, a decrease is the positive/good direction; every other metric
// here is "higher is better."
export function isGoodChange(metric: 'cac' | 'other', pct: number): boolean {
  return metric === 'cac' ? pct < 0 : pct > 0;
}

// ── Chart bucketing ──────────────────────────────────────────────────────

export interface DailyRow {
  entry_date: string;
  marketing_spend: number;
  gross_sales: number;
  total_buyers: number;
  new_customers: number;
  store_visits: number;
}

export interface ChartPoint {
  label: string;
  marketing_spend: number;
  gross_sales: number;
  total_buyers: number;
  store_visits: number;
}

function shortDateLabel(iso: string): string {
  return isoToUTC(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
function monthLabel(yyyyMM: string): string {
  return isoToUTC(`${yyyyMM}-01`).toLocaleDateString('en-PH', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// Aggregates raw daily rows into day/week/month buckets for the two trend
// charts — keeps the chart from being overcrowded on longer periods.
export function bucketForChart(rows: DailyRow[], granularity: 'day' | 'week' | 'month'): ChartPoint[] {
  const sorted = [...rows].sort((a, b) => a.entry_date.localeCompare(b.entry_date));

  if (granularity === 'day') {
    return sorted.map(r => ({
      label: shortDateLabel(r.entry_date),
      marketing_spend: r.marketing_spend,
      gross_sales: r.gross_sales,
      total_buyers: r.total_buyers,
      store_visits: r.store_visits,
    }));
  }

  const buckets = new Map<string, ChartPoint>();
  for (const r of sorted) {
    const key = granularity === 'week' ? startOfWeekMondayISO(r.entry_date) : r.entry_date.slice(0, 7);
    if (!buckets.has(key)) {
      buckets.set(key, {
        label: granularity === 'week' ? `Wk of ${shortDateLabel(key)}` : monthLabel(key),
        marketing_spend: 0, gross_sales: 0, total_buyers: 0, store_visits: 0,
      });
    }
    const b = buckets.get(key)!;
    b.marketing_spend += r.marketing_spend;
    b.gross_sales += r.gross_sales;
    b.total_buyers += r.total_buyers;
    b.store_visits += r.store_visits;
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v);
}

export interface PeriodSummary {
  marketing_spend: number;
  gross_sales: number;
  total_buyers: number;
  new_customers: number;
  store_visits: number;
}

export function sumRows(rows: DailyRow[]): PeriodSummary {
  return rows.reduce((acc, r) => ({
    marketing_spend: acc.marketing_spend + r.marketing_spend,
    gross_sales: acc.gross_sales + r.gross_sales,
    total_buyers: acc.total_buyers + r.total_buyers,
    new_customers: acc.new_customers + r.new_customers,
    store_visits: acc.store_visits + r.store_visits,
  }), { marketing_spend: 0, gross_sales: 0, total_buyers: 0, new_customers: 0, store_visits: 0 });
}
