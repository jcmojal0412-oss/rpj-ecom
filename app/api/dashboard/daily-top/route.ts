import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const db     = getDb();
    const period = req.nextUrl.searchParams.get('period') ?? 'today';

    let dateFilter: string;
    let label: string;

    if (period === 'yesterday') {
      const y = new Date();
      y.setDate(y.getDate() - 1);
      dateFilter = `date(sm.moved_at) = '${y.toISOString().slice(0, 10)}'`;
      label = y.toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' });
    } else if (period === '7days') {
      dateFilter = `sm.moved_at >= datetime('now', '-7 days')`;
      label = 'Last 7 Days';
    } else {
      const today = new Date().toISOString().slice(0, 10);
      dateFilter = `date(sm.moved_at) = '${today}'`;
      label = new Date().toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' });
    }

    const rows = db.prepare(`
      SELECT
        p.sku,
        p.name,
        COALESCE(SUM(CASE WHEN sm.type='OUT' THEN sm.quantity ELSE 0 END), 0) AS total_out,
        COALESCE(SUM(CASE WHEN sm.type='IN'  THEN sm.quantity ELSE 0 END), 0) AS total_in
      FROM products p
      LEFT JOIN stock_movements sm ON sm.product_id = p.id AND ${dateFilter}
      GROUP BY p.id
      HAVING total_out > 0
      ORDER BY total_out DESC
      LIMIT 10
    `).all();

    return NextResponse.json({ rows, label, period });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
