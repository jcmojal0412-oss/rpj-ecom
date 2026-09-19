import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Variance log + accuracy summary for the Inventory page. Accuracy is the
// share of counts that matched the system exactly; shrinkage/overage are
// valued at the product's cost as it stood when counted.
export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || (session.role !== 'owner' && !session.permissions.includes('inventory'))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const db = getDb();
    const days = Math.min(3650, Math.max(1, parseInt(req.nextUrl.searchParams.get('days') ?? '30', 10) || 30));
    const since = `datetime('now', '-${days} days')`;

    const rows = db.prepare(`
      SELECT c.id, c.counted_at, p.sku, p.name, c.expected_qty, c.counted_qty, c.variance,
             c.variance * c.unit_cost AS variance_value, c.reason, c.note, c.source,
             u.name AS counted_by_name
      FROM inventory_counts c
      JOIN products p ON p.id = c.product_id
      LEFT JOIN users u ON u.id = c.counted_by
      WHERE c.counted_at >= ${since}
      ORDER BY c.counted_at DESC, c.id DESC
      LIMIT 500
    `).all();

    const summary = db.prepare(`
      SELECT COUNT(*) AS total_counts,
             COALESCE(SUM(CASE WHEN variance = 0 THEN 1 ELSE 0 END), 0) AS matched,
             COALESCE(SUM(CASE WHEN variance < 0 THEN -variance * unit_cost ELSE 0 END), 0) AS shrink_value,
             COALESCE(SUM(CASE WHEN variance > 0 THEN variance * unit_cost ELSE 0 END), 0) AS overage_value,
             COALESCE(SUM(variance * unit_cost), 0) AS net_value
      FROM inventory_counts WHERE counted_at >= ${since}
    `).get() as { total_counts: number; matched: number; shrink_value: number; overage_value: number; net_value: number };

    // Products whose counts keep disagreeing with the system — the ones
    // worth investigating rather than just re-adjusting.
    const repeat = db.prepare(`
      SELECT p.sku, p.name, COUNT(*) AS times, SUM(c.variance) AS net_units, SUM(c.variance * c.unit_cost) AS net_value
      FROM inventory_counts c JOIN products p ON p.id = c.product_id
      WHERE c.counted_at >= ${since} AND c.variance != 0
      GROUP BY c.product_id HAVING COUNT(*) >= 2
      ORDER BY times DESC, ABS(net_value) DESC LIMIT 5
    `).all();

    return NextResponse.json({
      rows, repeat,
      summary: {
        ...summary,
        accuracy_pct: summary.total_counts > 0 ? (summary.matched / summary.total_counts) * 100 : null,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
