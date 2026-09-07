import { NextResponse } from 'next/server';
import { getDb, runTransaction } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Recomputes every product's true on-hand quantity directly from the full
// stock_movements ledger (SUM(IN) - SUM(OUT), voided rows excluded, floored
// at 0) instead of comparing against or adjusting the current
// inventory.quantity. Every quantity-affecting action in this app (manual
// Stock In/Out, PO receiving, POS sales, refunds, exchanges, void, bulk
// count) always writes a movement row with the correct quantity — the
// ledger itself was never wrong, only inventory.quantity (the running
// counter) could drift from it. Recomputing from scratch is what makes this
// safe to run any number of times: unlike an earlier version of this tool
// that subtracted a "missed quantity" delta from whatever inventory.quantity
// currently held (which was NOT safe to re-run — clicking it multiple times
// re-subtracted the same amount each time, driving some products to 0), this
// always lands on the same correct absolute number regardless of how many
// times it's been run before or what inventory.quantity currently says.
function findAffected(db: ReturnType<typeof getDb>) {
  const rows = db.prepare(`
    SELECT p.id as product_id, p.sku, p.name, COALESCE(i.quantity, 0) as current_stock,
      COALESCE(SUM(CASE WHEN sm.type='IN' THEN sm.quantity ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN sm.type='OUT' THEN sm.quantity ELSE 0 END), 0) as true_raw
    FROM products p
    LEFT JOIN inventory i ON i.product_id = p.id
    LEFT JOIN stock_movements sm ON sm.product_id = p.id AND sm.voided_at IS NULL
    GROUP BY p.id, p.sku, p.name, i.quantity
  `).all() as { product_id: number; sku: string; name: string; current_stock: number; true_raw: number }[];

  return rows
    .map(r => ({ ...r, true_quantity: Math.max(0, r.true_raw) }))
    .filter(r => r.true_quantity !== r.current_stock)
    .sort((a, b) => Math.abs(b.true_quantity - b.current_stock) - Math.abs(a.true_quantity - a.current_stock));
}

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== 'owner') return NextResponse.json({ error: 'Owner only' }, { status: 403 });

  const db = getDb();
  const affected = findAffected(db);
  return NextResponse.json({ affected });
}

export async function POST() {
  const session = await getSession();
  if (!session || session.role !== 'owner') return NextResponse.json({ error: 'Owner only' }, { status: 403 });

  const db = getDb();
  const affected = findAffected(db);
  if (affected.length === 0) return NextResponse.json({ corrected: 0, products: [] });

  const upsert = db.prepare(`
    INSERT INTO inventory (product_id, quantity, last_updated)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(product_id) DO UPDATE SET quantity = ?, last_updated = datetime('now')
  `);
  runTransaction(() => {
    for (const row of affected) upsert.run(row.product_id, row.true_quantity, row.true_quantity);
  });

  return NextResponse.json({ corrected: affected.length, products: affected });
}
