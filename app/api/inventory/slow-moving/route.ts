import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Slow-moving / dead stock: products still sitting on the shelf (quantity >
// 0 — nothing to move if there's nothing left) ranked by least sold in the
// lookback window first, and among equally-slow items, the ones tying up
// the most stock float to the top — that's the actual priority order for
// "which of these should I push to move first."
export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const { searchParams } = new URL(req.url);
    const days = Math.max(1, parseInt(searchParams.get('days') ?? '60', 10) || 60);
    const limit = Math.max(1, Math.min(100, parseInt(searchParams.get('limit') ?? '20', 10) || 20));

    // Sold quantity is pre-aggregated within the lookback window in its own
    // subquery, then joined to products — not a CASE inside the SUM, which
    // would join every product to the FULL history of its pos_sale_items
    // before filtering back down to the window at aggregation time (the
    // same fix already applied to the Dashboard's and POS Reports' own
    // slow-moving queries).
    const rows = db.prepare(`
      WITH sold AS (
        SELECT si.product_id, SUM(si.quantity) as qty_sold
        FROM pos_sale_items si
        JOIN pos_sales s ON s.id = si.sale_id
        WHERE s.status != 'Voided' AND s.sale_date >= date('now', '-' || ? || ' days')
        GROUP BY si.product_id
      )
      SELECT p.id, p.sku, p.name, p.category, COALESCE(inv.quantity, 0) as quantity,
             COALESCE(sold.qty_sold, 0) as qty_sold
      FROM products p
      LEFT JOIN inventory inv ON inv.product_id = p.id
      LEFT JOIN sold ON sold.product_id = p.id
      WHERE COALESCE(inv.quantity, 0) > 0
      ORDER BY qty_sold ASC, quantity DESC
      LIMIT ?
    `).all(days, limit);

    return NextResponse.json({ rows, days });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
