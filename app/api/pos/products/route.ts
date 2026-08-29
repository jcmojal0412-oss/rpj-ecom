import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    // POS grid order: manually pinned items (pos_featured) first, then by
    // actual sales velocity (last 30 days, freebie giveaways excluded so
    // they don't skew demand), then alphabetical for anything with no sales.
    const rows = db.prepare(`
      SELECT p.id, p.sku, p.name, p.category, p.srp, p.pos_featured,
             COALESCE(i.quantity, 0) as quantity
      FROM products p
      LEFT JOIN inventory i ON i.product_id = p.id
      LEFT JOIN (
        SELECT si.product_id, SUM(si.quantity) as qty_sold
        FROM pos_sale_items si
        JOIN pos_sales s ON s.id = si.sale_id
        WHERE s.status = 'Completed'
          AND (si.is_freebie IS NULL OR si.is_freebie = 0)
          AND s.sale_date >= date('now', '-30 days')
        GROUP BY si.product_id
      ) sales ON sales.product_id = p.id
      ORDER BY p.pos_featured DESC, COALESCE(sales.qty_sold, 0) DESC, p.name
    `).all();
    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
