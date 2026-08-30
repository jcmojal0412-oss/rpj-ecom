import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    // Only products still in stock — a discontinued/never-restocked item at
    // 0 has nothing left to move, so it's excluded rather than dominating
    // the "least sold" ranking with actionable-nonsense. Among equally slow
    // items, the one tying up the most stock floats to the top — that's the
    // actual priority order for what to push or promote first.
    const rows = db.prepare(`
      SELECT p.sku, p.name, COALESCE(inv.quantity, 0) as quantity,
             COALESCE(SUM(CASE WHEN sm.type='OUT' AND sm.moved_at >= datetime('now', '-30 days')
                                THEN sm.quantity ELSE 0 END), 0) as total_out
      FROM products p
      LEFT JOIN inventory inv ON inv.product_id = p.id
      LEFT JOIN stock_movements sm ON sm.product_id = p.id
      WHERE COALESCE(inv.quantity, 0) > 0
      GROUP BY p.id
      ORDER BY total_out ASC, COALESCE(inv.quantity, 0) DESC
      LIMIT 10
    `).all();
    return NextResponse.json(rows);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
