import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db    = getDb();
    const today = new Date().toISOString().slice(0, 10);

    const rows = db.prepare(`
      SELECT
        p.sku,
        p.name,
        COALESCE(SUM(CASE WHEN sm.type='OUT' THEN sm.quantity ELSE 0 END), 0) AS total_out,
        COALESCE(SUM(CASE WHEN sm.type='IN'  THEN sm.quantity ELSE 0 END), 0) AS total_in
      FROM products p
      LEFT JOIN stock_movements sm
        ON sm.product_id = p.id AND date(sm.moved_at) = ?
      GROUP BY p.id
      HAVING total_out > 0
      ORDER BY total_out DESC
      LIMIT 10
    `).all(today);

    return NextResponse.json(rows);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
