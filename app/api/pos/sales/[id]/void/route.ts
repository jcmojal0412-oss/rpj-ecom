import { NextRequest, NextResponse } from 'next/server';
import { getDb, runTransaction } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function PUT(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getDb();

    const sale = db.prepare('SELECT id, status FROM pos_sales WHERE id = ?').get(params.id) as
      { id: number; status: string } | undefined;
    if (!sale) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (sale.status === 'Voided') return NextResponse.json({ error: 'Already voided' }, { status: 400 });

    const items = db.prepare('SELECT product_id, quantity FROM pos_sale_items WHERE sale_id = ?').all(params.id) as
      { product_id: number; quantity: number }[];

    const updateSale = db.prepare(`UPDATE pos_sales SET status='Voided' WHERE id = ?`);
    const insertMovement = db.prepare(`
      INSERT INTO stock_movements (product_id, type, quantity, note, moved_at) VALUES (?, 'IN', ?, ?, datetime('now'))
    `);
    const adjustInventory = db.prepare(`
      INSERT INTO inventory (product_id, quantity, last_updated)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(product_id) DO UPDATE SET
        quantity = quantity + excluded.quantity,
        last_updated = datetime('now')
    `);

    runTransaction(() => {
      updateSale.run(params.id);
      for (const item of items) {
        insertMovement.run(item.product_id, item.quantity, `Void of Sale #${params.id}`);
        adjustInventory.run(item.product_id, item.quantity);
      }
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
