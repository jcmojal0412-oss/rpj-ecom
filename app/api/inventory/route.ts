import { NextRequest, NextResponse } from 'next/server';
import { getDb, runTransaction } from '@/lib/db';

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

// Manual stock correction — sets the quantity to an exact value (e.g. after
// a physical count) instead of a relative in/out. Logs a stock_movement so
// the adjustment still shows up in the movement history/audit trail.
export async function PUT(req: NextRequest) {
  try {
    const db = getDb();
    const { product_id, quantity } = await req.json();

    if (!product_id || quantity == null || quantity < 0) {
      return NextResponse.json({ error: 'product_id and a non-negative quantity are required' }, { status: 400 });
    }

    runTransaction(() => {
      const current = (db.prepare('SELECT COALESCE(quantity,0) as q FROM inventory WHERE product_id=?').get(product_id) as { q: number } | undefined)?.q ?? 0;
      const delta = quantity - current;

      db.prepare(`
        INSERT INTO inventory (product_id, quantity, last_updated)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(product_id) DO UPDATE SET quantity = ?, last_updated = datetime('now')
      `).run(product_id, quantity, quantity);

      if (delta !== 0) {
        db.prepare(
          'INSERT INTO stock_movements (product_id, type, quantity, note, moved_at) VALUES (?,?,?,?,datetime(\'now\'))'
        ).run(product_id, delta > 0 ? 'IN' : 'OUT', Math.abs(delta), 'Manual stock correction');
      }
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
