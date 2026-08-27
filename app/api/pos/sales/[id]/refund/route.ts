import { NextRequest, NextResponse } from 'next/server';
import { getDb, runTransaction } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { todayISO } from '@/lib/utils';

export const dynamic = 'force-dynamic';

interface RefundLine { sale_item_id: number; quantity: number; }

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const db = getDb();
    const saleId = Number(params.id);

    const sale = db.prepare('SELECT id, status FROM pos_sales WHERE id = ?').get(saleId) as
      { id: number; status: string } | undefined;
    if (!sale) return NextResponse.json({ error: 'Sale not found' }, { status: 404 });
    if (sale.status === 'Voided') return NextResponse.json({ error: 'Cannot refund a voided sale' }, { status: 400 });

    const { items, reason } = await req.json();
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'No items selected for refund' }, { status: 400 });
    }

    const getSaleItem = db.prepare('SELECT id, product_id, unit_price, quantity FROM pos_sale_items WHERE id = ? AND sale_id = ?');
    const getRefundedQty = db.prepare(
      `SELECT COALESCE(SUM(ri.quantity),0) as q FROM pos_refund_items ri
       JOIN pos_refunds r ON r.id = ri.refund_id WHERE ri.sale_item_id = ?`
    );

    const lineData: { sale_item_id: number; product_id: number | null; quantity: number; unit_price: number; line_total: number }[] = [];
    for (const raw of items as RefundLine[]) {
      const qty = parseInt(String(raw?.quantity), 10);
      if (!raw?.sale_item_id || !qty || qty <= 0) {
        return NextResponse.json({ error: 'Invalid refund line' }, { status: 400 });
      }
      const saleItem = getSaleItem.get(raw.sale_item_id, saleId) as
        { id: number; product_id: number | null; unit_price: number; quantity: number } | undefined;
      if (!saleItem) {
        return NextResponse.json({ error: `Line item #${raw.sale_item_id} does not belong to this sale` }, { status: 400 });
      }
      const alreadyRefunded = (getRefundedQty.get(saleItem.id) as { q: number }).q;
      const remaining = saleItem.quantity - alreadyRefunded;
      if (qty > remaining) {
        return NextResponse.json({ error: `Only ${remaining} unit(s) left to refund for this item` }, { status: 400 });
      }
      lineData.push({
        sale_item_id: saleItem.id, product_id: saleItem.product_id,
        quantity: qty, unit_price: saleItem.unit_price, line_total: saleItem.unit_price * qty,
      });
    }

    const totalRefund = lineData.reduce((s, l) => s + l.line_total, 0);

    const insertRefund = db.prepare(`
      INSERT INTO pos_refunds (sale_id, refund_date, total_refund, reason, cashier_id)
      VALUES (?,?,?,?,?)
    `);
    const insertRefundItem = db.prepare(`
      INSERT INTO pos_refund_items (refund_id, sale_item_id, product_id, quantity, unit_price, line_total)
      VALUES (?,?,?,?,?,?)
    `);
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

    const refundId = runTransaction(() => {
      const info = insertRefund.run(saleId, todayISO(), totalRefund, reason?.trim() || null, session.id);
      const id = Number(info.lastInsertRowid);
      for (const l of lineData) {
        insertRefundItem.run(id, l.sale_item_id, l.product_id, l.quantity, l.unit_price, l.line_total);
        if (l.product_id) {
          insertMovement.run(l.product_id, l.quantity, `Refund of Sale #${saleId}`);
          adjustInventory.run(l.product_id, l.quantity);
        }
      }
      return id;
    });

    return NextResponse.json({ id: refundId, total_refund: totalRefund }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
