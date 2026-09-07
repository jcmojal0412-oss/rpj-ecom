import { NextResponse } from 'next/server';
import { getDb, runTransaction } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// One-time correction for the inventory-deduction bug fixed in
// app/api/pos/sales/route.ts (see that commit) — introduced 2026-08-29
// 16:46:45 UTC (Railway deploy of commit 11bd709, "Floor POS checkout stock
// deduction at 0"), which made every regular POS sale/freebie line's stock
// deduction a silent no-op: the stock_movements OUT row was logged
// correctly every time, but inventory.quantity never actually moved.
//
// The fix only needs to resync inventory.quantity to match what the
// already-correct stock_movements ledger says should have happened — no new
// movement rows are written here, since the original "POS Sale #..." rows
// already fully and correctly describe what was sold; only the derived
// on-hand counter was wrong. Exchange-driven OUT rows are excluded because
// the Exchange route has always used a correct upsert (never shared this
// bug), so backing them out again here would double-deduct.
const BUG_LIVE_SINCE = '2026-08-29 16:46:45';

function findAffected(db: ReturnType<typeof getDb>) {
  const rows = db.prepare(`
    SELECT sm.product_id, p.sku, p.name, COALESCE(i.quantity, 0) as current_stock,
           SUM(sm.quantity) as missed_qty
    FROM stock_movements sm
    JOIN products p ON p.id = sm.product_id
    LEFT JOIN inventory i ON i.product_id = sm.product_id
    WHERE sm.type = 'OUT' AND sm.voided_at IS NULL
      AND sm.note LIKE 'POS Sale #%' AND sm.note NOT LIKE '%(Exchange)%'
      AND sm.moved_at >= ?
    GROUP BY sm.product_id, p.sku, p.name, i.quantity
    HAVING missed_qty > 0
    ORDER BY missed_qty DESC
  `).all(BUG_LIVE_SINCE) as { product_id: number; sku: string; name: string; current_stock: number; missed_qty: number }[];

  return rows.map(r => ({
    ...r,
    corrected_stock: Math.max(0, r.current_stock - r.missed_qty),
  }));
}

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== 'owner') return NextResponse.json({ error: 'Owner only' }, { status: 403 });

  const db = getDb();
  const affected = findAffected(db);
  const totalMissedUnits = affected.reduce((s, r) => s + r.missed_qty, 0);
  return NextResponse.json({ affected, totalMissedUnits, bugLiveSince: BUG_LIVE_SINCE });
}

export async function POST() {
  const session = await getSession();
  if (!session || session.role !== 'owner') return NextResponse.json({ error: 'Owner only' }, { status: 403 });

  const db = getDb();
  const affected = findAffected(db);
  if (affected.length === 0) return NextResponse.json({ corrected: 0, products: [] });

  const update = db.prepare('UPDATE inventory SET quantity = ?, last_updated = datetime(\'now\') WHERE product_id = ?');
  runTransaction(() => {
    for (const row of affected) update.run(row.corrected_stock, row.product_id);
  });

  return NextResponse.json({ corrected: affected.length, products: affected });
}
