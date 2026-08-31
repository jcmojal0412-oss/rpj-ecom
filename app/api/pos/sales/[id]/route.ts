import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Deliberately readable by any authenticated 'pos' user for ANY sale ID, not
// just the caller's own — Return/Exchange needs to look up a sale rung up by
// a different cashier (a customer can return to whoever's on shift today,
// not just who sold it). Sales History's own cashier-scoping lives in the
// LIST route (GET /api/pos/sales) instead; this is the detail lookup that
// list's "Find by Sale #/Receipt #" flow depends on. Session is still
// required so this can't be hit by a fully unauthenticated caller.
export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

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
      SELECT id, sale_item_id, product_id, quantity, unit_price, line_total, condition
      FROM pos_refund_items WHERE refund_id = ? ORDER BY id
    `);
    const refunds = refundRows.map(r => ({ ...r, items: getRefundItems.all(r.id) }));

    // Only populated for a sale whose payment was collected across more
    // than one tender (Split mode, or a multi-method Financing
    // downpayment) — empty for the common single-tender case, which the
    // existing cash_amount/online_amount/payment_method fields already
    // describe fully.
    const payments = db.prepare(`
      SELECT id, method, amount, reference_no FROM pos_sale_payments WHERE sale_id = ? ORDER BY id
    `).all(params.id);

    return NextResponse.json({ sale, items, refunds, payments });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
