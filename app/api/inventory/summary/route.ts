import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { todayISO } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    const today = todayISO();

    // moved_at is compared as a text range (>= today AND < tomorrow) instead
    // of date(moved_at) = today — wrapping the column in date() stops SQLite
    // from using idx_stock_movements_moved_at, forcing a full scan of every
    // movement ever recorded on each call. Same rows match either way.
    // current_qty already includes all movements (inventory is updated on every movement insert).
    // opening_stock = what was on hand at start of today = current - today_in + today_out
    // remaining     = current_qty  (it IS the remaining stock right now)
    const rows = db.prepare(`
      WITH today_in AS (
        SELECT product_id, COALESCE(SUM(quantity), 0) AS qty
        FROM stock_movements
        WHERE type = 'IN' AND moved_at >= ? AND moved_at < date(?, '+1 day')
        GROUP BY product_id
      ),
      today_out AS (
        SELECT product_id, COALESCE(SUM(quantity), 0) AS qty
        FROM stock_movements
        WHERE type = 'OUT' AND moved_at >= ? AND moved_at < date(?, '+1 day')
        GROUP BY product_id
      )
      SELECT
        p.sku,
        p.name,
        p.cogs,
        COALESCE(i.quantity, 0)                                                           AS remaining,
        COALESCE(i.quantity, 0) - COALESCE(ti.qty, 0) + COALESCE(to2.qty, 0)             AS opening_stock,
        COALESCE(ti.qty, 0)                                                               AS stock_in,
        COALESCE(to2.qty, 0)                                                              AS stock_out,
        COALESCE(i.quantity, 0) * p.cogs                                                  AS inventory_value
      FROM products p
      LEFT JOIN inventory  i   ON i.product_id  = p.id
      LEFT JOIN today_in   ti  ON ti.product_id = p.id
      LEFT JOIN today_out  to2 ON to2.product_id = p.id
      ORDER BY p.sku
    `).all(today, today, today, today);

    return NextResponse.json(rows);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
