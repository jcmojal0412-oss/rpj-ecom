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

    return NextResponse.json({ inventoryValue, totalSkus, stockIn, stockOut, prevStockIn, prevStockOut });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
