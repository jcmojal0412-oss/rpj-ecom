import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT p.sku, p.name, COALESCE(SUM(sm.quantity),0) as total_out
      FROM products p
      LEFT JOIN stock_movements sm
        ON sm.product_id = p.id AND sm.type='OUT'
        AND sm.moved_at >= datetime('now', '-30 days')
      GROUP BY p.id
      ORDER BY total_out ASC
      LIMIT 10
    `).all();
    return NextResponse.json(rows);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
