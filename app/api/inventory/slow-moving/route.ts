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

    const rows = db.prepare(`
      SELECT p.id, p.sku, p.name, p.category, COALESCE(inv.quantity, 0) as quantity,
             COALESCE(SUM(CASE WHEN s.status != 'Voided' AND s.sale_date >= date('now', '-' || ? || ' days')
                                THEN si.quantity ELSE 0 END), 0) as qty_sold
      FROM products p
      LEFT JOIN inventory inv ON inv.product_id = p.id
      LEFT JOIN pos_sale_items si ON si.product_id = p.id
      LEFT JOIN pos_sales s ON s.id = si.sale_id
      WHERE COALESCE(inv.quantity, 0) > 0
      GROUP BY p.id, p.sku, p.name, p.category, inv.quantity
      ORDER BY qty_sold ASC, quantity DESC
      LIMIT ?
    `).all(days, limit);

    return NextResponse.json({ rows, days });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
