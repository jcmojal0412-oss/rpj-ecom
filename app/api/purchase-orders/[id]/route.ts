import { NextRequest, NextResponse } from 'next/server';
import { getDb, runTransaction } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getDb();
    const po = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(params.id);
    if (!po) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const items = db.prepare(`
      SELECT poi.*, p.name, p.sku
      FROM po_items poi JOIN products p ON p.id=poi.product_id
      WHERE poi.po_id=?
    `).all(params.id);

    return NextResponse.json({ ...po as object, items });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getDb();
    const body = await req.json();
    const { status } = body;

    const existing = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(params.id) as
      { status: string; po_number: string } | undefined;
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    runTransaction(() => {
      db.prepare(
        `UPDATE purchase_orders SET status=?, received_at=CASE WHEN ?='received' THEN datetime('now') ELSE received_at END WHERE id=?`
      ).run(status, status, params.id);

      if (status === 'received' && existing.status !== 'received') {
        const items = db.prepare('SELECT * FROM po_items WHERE po_id=?').all(params.id) as
          { product_id: number; quantity: number }[];
        for (const item of items) {
          db.prepare(
            `UPDATE inventory SET quantity=quantity+?, last_updated=datetime('now') WHERE product_id=?`
          ).run(item.quantity, item.product_id);
          db.prepare(
            'INSERT INTO stock_movements (product_id, type, quantity, note, moved_at) VALUES (?,?,?,?,datetime("now"))'
          ).run(item.product_id, 'IN', item.quantity, `PO ${existing.po_number} received`);
        }
      }
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
