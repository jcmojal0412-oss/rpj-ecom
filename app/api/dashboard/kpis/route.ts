import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { todayISO } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// inventoryValue / totalSkus are current-state snapshots (not date-ranged).
// stockIn / stockOut respond to an optional ?from&to range (defaults to
// today, matching the historical behavior of this endpoint); prevStockIn /
// prevStockOut are only computed when ?prevFrom&prevTo are also supplied,
// powering the dashboard's "vs previous period" comparison badges.
export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const today = todayISO();
    const { searchParams } = req.nextUrl;
    const from = searchParams.get('from') || today;
    const to = searchParams.get('to') || today;
    const prevFrom = searchParams.get('prevFrom');
    const prevTo = searchParams.get('prevTo');

    const inventoryValue = (db.prepare(`
      SELECT COALESCE(SUM(i.quantity * p.cogs), 0) as value
      FROM inventory i JOIN products p ON p.id = i.product_id
    `).get() as { value: number }).value;

    const totalSkus = (db.prepare('SELECT COUNT(*) as c FROM products').get() as { c: number }).c;

    const sumMovement = (type: 'IN' | 'OUT', f: string, t: string) => (db.prepare(`
      SELECT COALESCE(SUM(quantity), 0) as total FROM stock_movements
      WHERE type=? AND date(moved_at) BETWEEN ? AND ?
    `).get(type, f, t) as { total: number }).total;

    const stockIn = sumMovement('IN', from, to);
    const stockOut = sumMovement('OUT', from, to);

    let prevStockIn: number | null = null;
    let prevStockOut: number | null = null;
    if (prevFrom && prevTo) {
      prevStockIn = sumMovement('IN', prevFrom, prevTo);
      prevStockOut = sumMovement('OUT', prevFrom, prevTo);
    }

    // Stock Out is the one direction that genuinely IS attributable per
    // business (it's driven by sales, which each belong to one) — Stock In
    // (purchase orders, manual counts, Bulk Stock Count) restocks the one
    // shared inventory pool, not "for" any specific business, so it isn't
    // split the same way. stock_movements carries no business_id column at
    // all (products/inventory are one shared pool); a POS sale's OUT
    // movement is recovered here by matching its note back to the sale it
    // came from ("POS Sale #123" / "POS Sale #123 (Freebie)" — the exact
    // format app/api/pos/sales/route.ts writes) rather than trusting a
    // string LIKE join, which would silently scan every sale per movement —
    // CAST(...) extracts just the numeric id so this stays a real integer
    // join on pos_sales' primary key. Anything that doesn't match (manual
    // stock-out, damage write-offs, etc.) falls into "Other".
    const stockOutByBusiness = db.prepare(`
      SELECT COALESCE(b.name, 'Other') as business_name, COALESCE(SUM(sm.quantity),0) as total
      FROM stock_movements sm
      LEFT JOIN pos_sales s ON sm.note LIKE 'POS Sale #%' AND s.id = CAST(REPLACE(sm.note, 'POS Sale #', '') AS INTEGER)
      LEFT JOIN businesses b ON b.id = s.business_id
      WHERE sm.type = 'OUT' AND date(sm.moved_at) BETWEEN ? AND ?
      GROUP BY business_name
      ORDER BY total DESC
    `).all(from, to) as { business_name: string; total: number }[];

    return NextResponse.json({ inventoryValue, totalSkus, stockIn, stockOut, prevStockIn, prevStockOut, stockOutByBusiness });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
