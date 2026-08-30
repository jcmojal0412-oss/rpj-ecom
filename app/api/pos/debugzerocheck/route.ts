import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

// TEMPORARY diagnostic — checks whether zero-stock products ever had ANY
// stock_movements at all (never stocked in — a setup gap) vs. had movements
// that netted them down to zero (genuine depletion, needs restock).
export async function GET() {
  try {
    const db = getDb();
    const zeroProducts = db.prepare(`
      SELECT p.id, p.sku, p.name, p.created_at, COALESCE(i.quantity,0) as quantity
      FROM products p LEFT JOIN inventory i ON i.product_id = p.id
      WHERE COALESCE(i.quantity,0) <= 0
    `).all() as { id: number; sku: string; name: string; created_at: string; quantity: number }[];

    let neverMoved = 0;
    let hadMovements = 0;
    const sample: { sku: string; name: string; created_at: string; movementCount: number }[] = [];

    for (const p of zeroProducts) {
      const count = (db.prepare('SELECT COUNT(*) as c FROM stock_movements WHERE product_id = ?').get(p.id) as { c: number }).c;
      if (count === 0) neverMoved++; else hadMovements++;
      if (sample.length < 15) sample.push({ sku: p.sku, name: p.name, created_at: p.created_at, movementCount: count });
    }

    const totalProducts = (db.prepare('SELECT COUNT(*) as c FROM products').get() as { c: number }).c;

    return NextResponse.json({
      totalProducts,
      totalZeroStock: zeroProducts.length,
      neverHadAnyStockMovement: neverMoved,
      hadMovementsButNowZero: hadMovements,
      sample,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
