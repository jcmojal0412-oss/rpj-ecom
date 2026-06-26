import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();

    const monthly = db.prepare(`
      SELECT
        strftime('%Y-%m', ordered_at)          AS month,
        COUNT(*)                                AS order_count,
        COALESCE(SUM(total_amount), 0)          AS total_ordered,
        COALESCE(SUM(paid_amount), 0)           AS total_paid,
        COALESCE(SUM(total_amount - COALESCE(paid_amount,0)), 0) AS outstanding
      FROM purchase_orders
      WHERE status != 'cancelled' AND ordered_at IS NOT NULL
      GROUP BY month
      ORDER BY month DESC
      LIMIT 24
    `).all();

    const totals = db.prepare(`
      SELECT
        COALESCE(SUM(total_amount), 0)          AS grand_total_ordered,
        COALESCE(SUM(paid_amount), 0)           AS grand_total_paid,
        COALESCE(SUM(total_amount - COALESCE(paid_amount,0)), 0) AS grand_outstanding
      FROM purchase_orders
      WHERE status != 'cancelled'
    `).get();

    return NextResponse.json({ monthly, totals });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
