import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { todayISO } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// Reconstructs each product's on-hand quantity as of a given date by
// "rewinding" the current live quantity — undoing every movement that
// happened AFTER that date — same technique already used by the Inventory
// Movement report. Defaults to today, which naturally reduces to the current
// live quantity (nothing to rewind). Lets the owner see which products were
// already negative before today's corrections, not just which are negative
// right now.
export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const asOf = req.nextUrl.searchParams.get('as_of') || todayISO();

    const rows = db.prepare(`
      WITH after AS (
        SELECT product_id,
          COALESCE(SUM(CASE WHEN type='IN' THEN quantity ELSE 0 END),0) as in_after,
          COALESCE(SUM(CASE WHEN type='OUT' THEN quantity ELSE 0 END),0) as out_after
        FROM stock_movements
        WHERE date(moved_at) > ?
        GROUP BY product_id
      )
      SELECT p.id, p.sku, p.name, p.category,
        (COALESCE(i.quantity,0) - COALESCE(a.in_after,0) + COALESCE(a.out_after,0)) as quantity
      FROM products p
      LEFT JOIN inventory i ON i.product_id = p.id
      LEFT JOIN after a ON a.product_id = p.id
      WHERE (COALESCE(i.quantity,0) - COALESCE(a.in_after,0) + COALESCE(a.out_after,0)) < 0
      ORDER BY quantity ASC
    `).all(asOf);

    return NextResponse.json({ rows, as_of: asOf });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
