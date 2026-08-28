import { NextRequest, NextResponse } from 'next/server';
import { getDb, runTransaction } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function PUT(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    if (session.role !== 'owner') return NextResponse.json({ error: 'Only the owner can void a sale' }, { status: 403 });

    const db = getDb();

    const sale = db.prepare('SELECT id, status FROM pos_sales WHERE id = ?').get(params.id) as
      { id: number; status: string } | undefined;
    if (!sale) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (sale.status === 'Voided') return NextResponse.json({ error: 'Already voided' }, { status: 400 });

    const items = db.prepare('SELECT id, product_id, quantity FROM pos_sale_items WHERE sale_id = ?').all(params.id) as
      { id: number; product_id: number; quantity: number }[];
    // A line already partially refunded/exchanged had its returned units
    // restocked (or scrapped, if Defective) at refund time — voiding must
    // only reverse the portion that's still "out" with the customer, or the
    // already-returned units get restocked a second time.
    const getRefundedQty = db.prepare(
      `SELECT COALESCE(SUM(ri.quantity),0) as q FROM pos_refund_items ri
       JOIN pos_refunds r ON r.id = ri.refund_id WHERE ri.sale_item_id = ?`
    );

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
        const alreadyRefunded = (getRefundedQty.get(item.id) as { q: number }).q;
        const restockQty = item.quantity - alreadyRefunded;
        if (restockQty <= 0) continue;
        insertMovement.run(item.product_id, restockQty, `Void of Sale #${params.id}`);
        adjustInventory.run(item.product_id, restockQty);
      }
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
