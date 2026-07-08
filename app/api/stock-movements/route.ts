import { NextRequest, NextResponse } from 'next/server';
import { getDb, runTransaction } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const { searchParams } = req.nextUrl;
    const productId = searchParams.get('product_id');
    const date      = searchParams.get('date');
    const days      = searchParams.get('days') ?? '7';

    let sql = `
      SELECT sm.*, p.sku, p.name
      FROM stock_movements sm
      JOIN products p ON p.id = sm.product_id
      WHERE sm.moved_at >= datetime('now', '-${parseInt(days)} days')
    `;
    const args: (string | number)[] = [];

    if (productId) { sql += ' AND sm.product_id=?'; args.push(productId); }
    if (date)      { sql += ' AND date(sm.moved_at)=?'; args.push(date); }
    sql += ' ORDER BY sm.moved_at DESC LIMIT 500';

    const rows = db.prepare(sql).all(...args);
    return NextResponse.json(rows);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = getDb();
    const { product_id, type, quantity, note, moved_at } = await req.json();

    if (!['IN', 'OUT'].includes(type)) {
      return NextResponse.json({ error: 'type must be IN or OUT' }, { status: 400 });
    }

    runTransaction(() => {
      const delta = type === 'IN' ? quantity : -quantity;
      db.prepare(
        'INSERT INTO stock_movements (product_id, type, quantity, note, moved_at) VALUES (?,?,?,?,?)'
      ).run(product_id, type, quantity, note ?? '', moved_at ?? new Date().toISOString());
      // Upsert: a plain UPDATE silently affects zero rows if a product is
      // somehow missing its inventory row, logging the movement but never
      // creating the actual stock count. INSERT..ON CONFLICT guarantees the
      // row exists either way.
      db.prepare(`
        INSERT INTO inventory (product_id, quantity, last_updated)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(product_id) DO UPDATE SET
          quantity = quantity + excluded.quantity,
          last_updated = datetime('now')
      `).run(product_id, delta);
    });

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
