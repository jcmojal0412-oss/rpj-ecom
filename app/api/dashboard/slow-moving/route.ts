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
    //
    // The 30-day filter used to live in a CASE inside the SUM, applied
    // AFTER joining every product to its full stock_movements history —
    // so a product with years of movements got joined in full just to be
    // filtered back down at aggregation time. Moved into the JOIN's own ON
    // clause (matching how fast-moving/route.ts already does it) so the
    // join only ever touches rows inside the window to begin with.
    const rows = db.prepare(`
      SELECT p.sku, p.name, COALESCE(inv.quantity, 0) as quantity,
             COALESCE(SUM(sm.quantity), 0) as total_out
      FROM products p
      LEFT JOIN inventory inv ON inv.product_id = p.id
      LEFT JOIN stock_movements sm
        ON sm.product_id = p.id AND sm.type='OUT'
        AND sm.moved_at >= datetime('now', '-30 days')
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
