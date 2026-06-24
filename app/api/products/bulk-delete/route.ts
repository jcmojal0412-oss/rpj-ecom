import { NextRequest, NextResponse } from 'next/server';
import { getDb, runTransaction } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { ids } = await req.json() as { ids: number[] };
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'No IDs provided' }, { status: 400 });
    }

    const db = getDb();
    const ph = ids.map(() => '?').join(','); // placeholders: ?,?,?

    runTransaction(() => {
      // Delete child records first (FK constraints)
      db.prepare(`DELETE FROM stock_movements WHERE product_id IN (${ph})`).run(...ids);
      db.prepare(`DELETE FROM po_items WHERE product_id IN (${ph})`).run(...ids);
      db.prepare(`DELETE FROM inventory WHERE product_id IN (${ph})`).run(...ids);
      db.prepare(`DELETE FROM products WHERE id IN (${ph})`).run(...ids);
    });

    return NextResponse.json({ deleted: ids.length });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
