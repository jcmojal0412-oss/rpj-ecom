import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { todayISO } from '@/lib/utils';
import {
  resolvePeriod, sumRows, bucketForChart,
  computeCAC, computeConversionRate, computeROAS, computeAvgSpendPerBuyer, pctChange,
  type PeriodKey, type DailyRow,
} from '@/lib/marketing-analytics';

export const dynamic = 'force-dynamic';

const VALID_KEYS: PeriodKey[] = [
  'today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month',
  'last_3_months', '1_year', 'custom',
];

function kpisFromSummary(s: { marketing_spend: number; gross_sales: number; total_buyers: number; new_customers: number; store_visits: number }) {
  return {
    marketing_spend: s.marketing_spend,
    gross_sales: s.gross_sales,
    total_buyers: s.total_buyers,
    new_customers: s.new_customers,
    store_visits: s.store_visits,
    cac: computeCAC(s.marketing_spend, s.new_customers),
    conversion_rate: computeConversionRate(s.total_buyers, s.store_visits),
    roas: computeROAS(s.gross_sales, s.marketing_spend),
    avg_spend_per_buyer: computeAvgSpendPerBuyer(s.gross_sales, s.total_buyers),
  };
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const periodParam = params.get('period') as PeriodKey | null;
  const period: PeriodKey = periodParam && VALID_KEYS.includes(periodParam) ? periodParam : 'this_month';
  const customFrom = params.get('from') || undefined;
  const customTo = params.get('to') || undefined;

  const range = resolvePeriod(period, todayISO(), customFrom, customTo);

  const db = getDb();
  const currentRows = db.prepare(
    'SELECT entry_date, marketing_spend, gross_sales, total_buyers, new_customers, store_visits FROM marketing_performance WHERE entry_date BETWEEN ? AND ? ORDER BY entry_date ASC'
  ).all(range.from, range.to) as DailyRow[];
  const previousRows = db.prepare(
    'SELECT entry_date, marketing_spend, gross_sales, total_buyers, new_customers, store_visits FROM marketing_performance WHERE entry_date BETWEEN ? AND ?'
  ).all(range.prevFrom, range.prevTo) as DailyRow[];

  const currentSummary = sumRows(currentRows);
  const previousSummary = sumRows(previousRows);
  const kpis = kpisFromSummary(currentSummary);
  const previousKpis = kpisFromSummary(previousSummary);

  const changes = {
    marketing_spend: pctChange(kpis.marketing_spend, previousKpis.marketing_spend),
    gross_sales: pctChange(kpis.gross_sales, previousKpis.gross_sales),
    total_buyers: pctChange(kpis.total_buyers, previousKpis.total_buyers),
    store_visits: pctChange(kpis.store_visits, previousKpis.store_visits),
    cac: kpis.cac != null && previousKpis.cac != null ? pctChange(kpis.cac, previousKpis.cac) : null,
    conversion_rate: kpis.conversion_rate != null && previousKpis.conversion_rate != null ? pctChange(kpis.conversion_rate, previousKpis.conversion_rate) : null,
    roas: kpis.roas != null && previousKpis.roas != null ? pctChange(kpis.roas, previousKpis.roas) : null,
    avg_spend_per_buyer: kpis.avg_spend_per_buyer != null && previousKpis.avg_spend_per_buyer != null ? pctChange(kpis.avg_spend_per_buyer, previousKpis.avg_spend_per_buyer) : null,
  };

  const chart = bucketForChart(currentRows, range.granularity);

  return NextResponse.json({
    range,
    kpis,
    previousKpis,
    changes,
    chart,
    dailyRows: currentRows.slice().reverse(), // newest first for the table
  });
}
