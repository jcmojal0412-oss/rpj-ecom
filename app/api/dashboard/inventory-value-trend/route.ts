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
      return { date, opening, stockInValue, stockOutValue, closing };
    });

    return NextResponse.json({ trend, currentValue });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
