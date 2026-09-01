import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { todayISO } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const WINDOW_DAYS = 14;

function addDaysISO(dateISO: string, delta: number): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + delta * 86_400_000).toISOString().slice(0, 10);
}

// Reconstructs day-by-day CLOSING inventory value for the trailing 14 days,
// answering "why does Total Inventory Value look flat/not going down" —
// walking backward from today's real total (same INNER JOIN inventory/
// products query the Dashboard KPI itself uses) and undoing each day's net
// stock movement, valued at each product's CURRENT cogs (an approximation —
// same one the Daily Remaining Stock Summary already makes; historical cogs
// isn't tracked per movement). This is what actually surfaces the tug-of-war
// between sales depleting already-counted stock and Bulk Stock Count
// entries adding previously-uncounted products' value for the first time.
export async function GET() {
  try {
    const db = getDb();
    const today = todayISO();
    const windowStart = addDaysISO(today, -(WINDOW_DAYS - 1));

    const currentValue = (db.prepare(`
      SELECT COALESCE(SUM(i.quantity * p.cogs), 0) as value
      FROM inventory i JOIN products p ON p.id = i.product_id
    `).get() as { value: number }).value;

    const dailyRows = db.prepare(`
      SELECT date(sm.moved_at) as date,
        COALESCE(SUM(CASE WHEN sm.type='IN' THEN sm.quantity * p.cogs ELSE 0 END),0) as stock_in_value,
        COALESCE(SUM(CASE WHEN sm.type='OUT' THEN sm.quantity * p.cogs ELSE 0 END),0) as stock_out_value
      FROM stock_movements sm
      JOIN products p ON p.id = sm.product_id
      WHERE date(sm.moved_at) >= ?
      GROUP BY date(sm.moved_at)
    `).all(windowStart) as { date: string; stock_in_value: number; stock_out_value: number }[];

    // Same per-business recovery as the Stock Out KPI card
    // (app/api/dashboard/kpis) — Stock Out is sale-driven, so each OUT
    // movement's business is recovered by matching its note back to the
    // sale it came from, rather than trusting a schema column that doesn't
    // exist (stock_movements has no business_id; products/inventory are one
    // shared pool). Stock In stays a single combined figure — restocking
    // isn't "for" one business the way a sale is.
    const byBusinessRows = db.prepare(`
      SELECT date(sm.moved_at) as date, COALESCE(b.name, 'Other') as business_name,
        COALESCE(SUM(sm.quantity * p.cogs), 0) as value
      FROM stock_movements sm
      JOIN products p ON p.id = sm.product_id
      LEFT JOIN pos_sales s ON sm.note LIKE 'POS Sale #%' AND s.id = CAST(REPLACE(sm.note, 'POS Sale #', '') AS INTEGER)
      LEFT JOIN businesses b ON b.id = s.business_id
      WHERE sm.type = 'OUT' AND date(sm.moved_at) >= ?
      GROUP BY date(sm.moved_at), business_name
    `).all(windowStart) as { date: string; business_name: string; value: number }[];

    const stockOutByBusinessByDate = new Map<string, { business_name: string; value: number }[]>();
    for (const row of byBusinessRows) {
      if (!stockOutByBusinessByDate.has(row.date)) stockOutByBusinessByDate.set(row.date, []);
      stockOutByBusinessByDate.get(row.date)!.push({ business_name: row.business_name, value: row.value });
    }

    const byDate = new Map(dailyRows.map(r => [r.date, r]));
    const dates: string[] = [];
    for (let i = 0; i < WINDOW_DAYS; i++) dates.push(addDaysISO(windowStart, i));

    // Net movement across the whole window, so we can walk backward from
    // today's real total to the value as of the START of the window
    // (the "before" for day 1's "after").
    const totalNet = dates.reduce((sum, date) => {
      const row = byDate.get(date);
      return sum + (row ? row.stock_in_value - row.stock_out_value : 0);
    }, 0);

    let closing = currentValue - totalNet; // value at the end of the day BEFORE windowStart
    const trend = dates.map(date => {
      const row = byDate.get(date);
      const stockInValue = row?.stock_in_value ?? 0;
      const stockOutValue = row?.stock_out_value ?? 0;
      const opening = closing;
      closing = opening + stockInValue - stockOutValue;
      return { date, opening, stockInValue, stockOutValue, closing, stockOutByBusiness: stockOutByBusinessByDate.get(date) ?? [] };
    });

    return NextResponse.json({ trend, currentValue });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
