import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { todayISO } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// Beginning/Ending stock for an arbitrary date range — generalizes the same
// "rewind from current stock using stock_movements" logic already used for
// the always-today inventory summary (app/api/inventory/summary/route.ts),
// just with configurable from/to instead of hardcoded "today". products/
// inventory are shared across businesses (no business_id column anywhere
// in that part of the schema), so this report has no business filter.
export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const { searchParams } = new URL(req.url);
    const to = searchParams.get('to') || todayISO();
    const from = searchParams.get('from') || to;

    const rows = db.prepare(`
      WITH after_range AS (
        SELECT product_id,
          COALESCE(SUM(CASE WHEN type='IN' THEN quantity ELSE 0 END),0) as in_after,
          COALESCE(SUM(CASE WHEN type='OUT' THEN quantity ELSE 0 END),0) as out_after
        FROM stock_movements
        WHERE date(moved_at) > ?
        GROUP BY product_id
      ),
      during_range AS (
        SELECT product_id,
          COALESCE(SUM(CASE WHEN type='IN' THEN quantity ELSE 0 END),0) as in_during,
          COALESCE(SUM(CASE WHEN type='OUT' THEN quantity ELSE 0 END),0) as out_during
        FROM stock_movements
        WHERE date(moved_at) BETWEEN ? AND ?
        GROUP BY product_id
      )
      SELECT p.id as product_id, p.sku, p.name, p.category, p.cogs,
        (COALESCE(i.quantity,0) - COALESCE(ar.in_after,0) + COALESCE(ar.out_after,0)) as ending_qty,
        (COALESCE(i.quantity,0) - COALESCE(ar.in_after,0) + COALESCE(ar.out_after,0))
          - COALESCE(dr.in_during,0) + COALESCE(dr.out_during,0) as beginning_qty,
        COALESCE(dr.in_during,0) as stock_in,
        COALESCE(dr.out_during,0) as stock_out
      FROM products p
      LEFT JOIN inventory i ON i.product_id = p.id
      LEFT JOIN after_range ar ON ar.product_id = p.id
      LEFT JOIN during_range dr ON dr.product_id = p.id
      ORDER BY p.sku
    `).all(to, from, to) as {
      product_id: number; sku: string; name: string; category: string | null; cogs: number;
      ending_qty: number; beginning_qty: number; stock_in: number; stock_out: number;
    }[];

    const result = rows.map(r => ({
      ...r,
      beginning_value: r.beginning_qty * (r.cogs || 0),
      ending_value: r.ending_qty * (r.cogs || 0),
    }));

    return NextResponse.json({ rows: result, from, to });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
