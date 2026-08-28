import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getDb();
    const sale = db.prepare(`
      SELECT s.*, b.name as business_name, u.name as cashier_name
      FROM pos_sales s
      LEFT JOIN businesses b ON b.id = s.business_id
      LEFT JOIN users u ON u.id = s.cashier_id
      WHERE s.id = ?
    `).get(params.id);
    if (!sale) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const items = db.prepare(`
      SELECT id, product_id, product_name, sku, unit_price, quantity, line_total,
             is_freebie, original_price, freebie_reason
      FROM pos_sale_items WHERE sale_id = ? ORDER BY id
    `).all(params.id);

    const refundRows = db.prepare(`
      SELECT r.*, u.name as cashier_name
      FROM pos_refunds r
      LEFT JOIN users u ON u.id = r.cashier_id
      WHERE r.sale_id = ? ORDER BY r.id
    `).all(params.id) as { id: number }[];
    const getRefundItems = db.prepare(`
      SELECT id, sale_item_id, product_id, quantity, unit_price, line_total
      FROM pos_refund_items WHERE refund_id = ? ORDER BY id
    `);
    const refunds = refundRows.map(r => ({ ...r, items: getRefundItems.all(r.id) }));

    return NextResponse.json({ sale, items, refunds });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
