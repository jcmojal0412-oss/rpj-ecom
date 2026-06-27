import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const lowStock = req.nextUrl.searchParams.get('low_stock') === '1';

    let sql = `
      SELECT p.id, p.sku, p.name, p.category, p.cogs, p.srp, p.reorder_point,
             COALESCE(i.quantity, 0) as quantity, i.last_updated
      FROM products p
      LEFT JOIN inventory i ON i.product_id = p.id
    `;
    if (lowStock) {
      // Show critical (below reorder) + watch list (within 2x reorder), max 10, ordered by urgency
      sql += ` WHERE COALESCE(i.quantity,0) <= (p.reorder_point * 2)
               ORDER BY COALESCE(i.quantity,0) ASC
               LIMIT 10`;
    } else {
      sql += ' ORDER BY p.sku';
    }

    const rows = db.prepare(sql).all();
    return NextResponse.json(rows);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
