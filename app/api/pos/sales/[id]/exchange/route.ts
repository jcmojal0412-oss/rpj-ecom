import { NextRequest, NextResponse } from 'next/server';
import { getDb, runTransaction, nextReceiptNo } from '@/lib/db';
import { displayReceiptNo } from '@/components/pos/constants';
import { getSession } from '@/lib/auth';
import { todayISO } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const REFUND_METHODS = ['Cash', 'GCash', 'Maya', 'Sodexo', 'Bank Transfer', 'Credit Card'];

// Exchange = one returned line (reusing the exact same refund-quantity
// tracking as a plain refund) + one brand-new sale for the replacement
// item, atomically linked together. The new sale's price is always the
// replacement product's real SRP — never manually reduced — with the
// returned item's value applied as a credit against it (exchange_credit_
// applied), the same "deduction against Amount Due, not a discount"
// pattern already used for Downpayment Applied and Cashback Redeemed.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const db = getDb();
    const originalSaleId = Number(params.id);

    const originalSale = db.prepare('SELECT id, status, business_id, receipt_no FROM pos_sales WHERE id = ?').get(originalSaleId) as
      { id: number; status: string; business_id: number | null; receipt_no: string | null } | undefined;
    if (!originalSale) return NextResponse.json({ error: 'Original sale not found' }, { status: 404 });
    if (originalSale.status !== 'Completed') return NextResponse.json({ error: 'Original sale must be a completed sale' }, { status: 400 });

    const {
      return_item, new_product_id, cash_amount, online_amount, reference_no,
      refund_method, reason, freebies_returned, payment_method,
    } = await req.json();

    if (!return_item?.sale_item_id || !return_item?.quantity) {
      return NextResponse.json({ error: 'A returned item is required' }, { status: 400 });
    }
    const returnQty = parseInt(String(return_item.quantity), 10);
    if (!returnQty || returnQty <= 0) return NextResponse.json({ error: 'Invalid returned quantity' }, { status: 400 });
    if (return_item.condition && !['Sellable', 'Defective'].includes(return_item.condition)) {
      return NextResponse.json({ error: 'Invalid item condition' }, { status: 400 });
    }
    if (!new_product_id) return NextResponse.json({ error: 'A replacement product is required' }, { status: 400 });
    if (freebies_returned && !['YES', 'NO'].includes(freebies_returned)) {
      return NextResponse.json({ error: 'Invalid freebies_returned value' }, { status: 400 });
    }

    // Return Value comes only from the original sale's own stored unit_price
    // — never trusted from the client — same principle as every other
    // server-side re-pricing in this POS.
    const saleItem = db.prepare('SELECT id, product_id, unit_price, quantity FROM pos_sale_items WHERE id = ? AND sale_id = ?')
      .get(return_item.sale_item_id, originalSaleId) as { id: number; product_id: number | null; unit_price: number; quantity: number } | undefined;
    if (!saleItem) return NextResponse.json({ error: 'Returned item does not belong to the original sale' }, { status: 400 });

    const alreadyRefunded = (db.prepare(
      `SELECT COALESCE(SUM(ri.quantity),0) as q FROM pos_refund_items ri JOIN pos_refunds r ON r.id = ri.refund_id WHERE ri.sale_item_id = ?`
    ).get(saleItem.id) as { q: number }).q;
    const remaining = saleItem.quantity - alreadyRefunded;
    if (returnQty > remaining) {
      return NextResponse.json({ error: `Only ${remaining} unit(s) left to return for this item` }, { status: 400 });
    }
    const returnValue = saleItem.unit_price * returnQty;

    // New unit's price/cost re-derived server-side, exactly like a normal
    // sale — the client only ever picks which product, never its price.
    const newProduct = db.prepare(
      'SELECT p.id, p.name, p.sku, p.srp, p.cogs, COALESCE(i.quantity,0) as quantity FROM products p LEFT JOIN inventory i ON i.product_id = p.id WHERE p.id = ?'
    ).get(new_product_id) as { id: number; name: string; sku: string | null; srp: number | null; cogs: number | null; quantity: number } | undefined;
    if (!newProduct) return NextResponse.json({ error: 'Replacement product no longer exists' }, { status: 400 });
    if (newProduct.quantity < 1) {
      return NextResponse.json({ error: `"${newProduct.name}" is out of stock` }, { status: 400 });
    }
    const newUnitPrice = newProduct.srp ?? 0;

    const exchangeCreditApplied = Math.min(returnValue, newUnitPrice);
    const amountToPay = Math.max(0, newUnitPrice - returnValue);
    const excess = Math.max(0, returnValue - newUnitPrice);

    const cashNum = cash_amount ? parseFloat(cash_amount) : 0;
    const onlineNum = online_amount ? parseFloat(online_amount) : 0;
    if (cashNum < 0 || onlineNum < 0) return NextResponse.json({ error: 'Payment amounts cannot be negative' }, { status: 400 });
    const totalPayment = cashNum + onlineNum;
    if (amountToPay > 0 && totalPayment + 0.005 < amountToPay) {
      return NextResponse.json({ error: 'Payment is less than the amount to pay' }, { status: 400 });
    }

    let refundMethodVal: string | null = null;
    let cashOutAmount = 0;
    if (excess > 0) {
      if (!refund_method || !REFUND_METHODS.includes(refund_method)) {
        return NextResponse.json({ error: 'A refund method is required for the excess amount' }, { status: 400 });
      }
      refundMethodVal = refund_method;
      cashOutAmount = refund_method === 'Cash' ? excess : 0;
    }

    const changeDue = amountToPay > 0 ? Math.max(0, totalPayment - amountToPay) : 0;
    // payment_method is a descriptive label only (never used for any money
    // calculation) — trusted from the client exactly like every other
    // payment-method label in this POS (e.g. "GCash", "Cash + Maya").
    const paymentMethod =
      amountToPay <= 0 ? 'Exchange Credit'
      : (String(payment_method || '').trim() || (onlineNum > 0 ? 'Online' : 'Cash'));

    // Required, same as checkout and refund: an exchange both hands back
    // (or credits) the returned item's value and takes a new payment, with
    // nothing to reconcile either side against if no shift is open.
    const openShift = db.prepare(
      `SELECT id FROM pos_shifts WHERE business_id = ? AND cashier_id = ? AND status = 'Open'`
    ).get(originalSale.business_id, session.id) as { id: number } | undefined;
    if (!openShift) {
      return NextResponse.json({ error: 'You need to Start Shift before processing an exchange.' }, { status: 400 });
    }

    const insertRefund = db.prepare(`
      INSERT INTO pos_refunds (sale_id, refund_date, total_refund, reason, cashier_id, refund_method, cash_out_amount, freebies_returned, shift_id)
      VALUES (?,?,?,?,?,?,?,?,?)
    `);
    const insertRefundItem = db.prepare(`
      INSERT INTO pos_refund_items (refund_id, sale_item_id, product_id, quantity, unit_price, line_total, condition)
      VALUES (?,?,?,?,?,?,?)
    `);
    const insertMovementIn = db.prepare(`
      INSERT INTO stock_movements (product_id, type, quantity, note, moved_at) VALUES (?, 'IN', ?, ?, datetime('now'))
    `);
    const insertMovementOut = db.prepare(`
      INSERT INTO stock_movements (product_id, type, quantity, note, moved_at) VALUES (?, 'OUT', ?, ?, datetime('now'))
    `);
    const adjustInventory = db.prepare(`
      INSERT INTO inventory (product_id, quantity, last_updated)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(product_id) DO UPDATE SET
        quantity = quantity + excluded.quantity,
        last_updated = datetime('now')
    `);
    const insertSale = db.prepare(`
      INSERT INTO pos_sales
        (business_id, sale_date, subtotal, discount, additional_fee, tax_percent, tax_amount,
         service_charge, delivery_fee, total, cash_amount, online_amount, change_due,
         payment_method, reference_no, status, cashier_id, notes, shift_id, linked_sale_id, exchange_credit_applied, receipt_no)
      VALUES (?,?,?,0,0,0,0,0,0,?,?,?,?,?,?, 'Completed', ?, ?, ?, ?, ?, ?)
    `);
    const insertSaleItem = db.prepare(`
      INSERT INTO pos_sale_items (sale_id, product_id, product_name, sku, unit_price, cogs, quantity, line_total)
      VALUES (?,?,?,?,?,?,1,?)
    `);
    const linkRefundToExchange = db.prepare(`UPDATE pos_refunds SET linked_exchange_sale_id = ? WHERE id = ?`);

    const result = runTransaction(() => {
      const refundInfo = insertRefund.run(
        originalSaleId, todayISO(), returnValue, reason?.trim() || null, session.id,
        refundMethodVal, cashOutAmount, freebies_returned || null, openShift?.id ?? null,
      );
      const refundId = Number(refundInfo.lastInsertRowid);
      insertRefundItem.run(refundId, saleItem.id, saleItem.product_id, returnQty, saleItem.unit_price, returnValue, return_item.condition ?? null);
      if (saleItem.product_id && return_item.condition !== 'Defective') {
        insertMovementIn.run(saleItem.product_id, returnQty, `Return (Exchange) of Sale #${originalSaleId}`);
        adjustInventory.run(saleItem.product_id, returnQty);
      }

      const saleInfo = insertSale.run(
        originalSale.business_id, todayISO(), newUnitPrice, newUnitPrice, cashNum, onlineNum, changeDue,
        paymentMethod, reference_no?.trim() || null,
        session.id, `Exchange for ${displayReceiptNo(originalSale)}`, openShift?.id ?? null,
        originalSaleId, exchangeCreditApplied, nextReceiptNo(db),
      );
      const exchangeSaleId = Number(saleInfo.lastInsertRowid);
      insertSaleItem.run(exchangeSaleId, newProduct.id, newProduct.name, newProduct.sku, newUnitPrice, newProduct.cogs ?? 0, newUnitPrice);
      insertMovementOut.run(newProduct.id, 1, `POS Sale #${exchangeSaleId} (Exchange)`);
      adjustInventory.run(newProduct.id, -1);

      linkRefundToExchange.run(exchangeSaleId, refundId);

      return { refund_id: refundId, exchange_sale_id: exchangeSaleId };
    });

    return NextResponse.json({
      ...result,
      return_value: returnValue, new_unit_price: newUnitPrice,
      exchange_credit_applied: exchangeCreditApplied, amount_to_pay: amountToPay, excess,
    }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
