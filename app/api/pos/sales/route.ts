import { NextRequest, NextResponse } from 'next/server';
import { getDb, runTransaction, nextReceiptNo } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { todayISO } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const LIST_SQL_BASE = `
  SELECT s.*, b.name as business_name, u.name as cashier_name,
         (SELECT GROUP_CONCAT(DISTINCT product_name) FROM pos_sale_items
          WHERE sale_id = s.id AND product_id IS NULL) as service_items
  FROM pos_sales s
  LEFT JOIN businesses b ON b.id = s.business_id
  LEFT JOIN users u ON u.id = s.cashier_id
  WHERE 1=1
`;

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const db = getDb();
    const { searchParams } = new URL(req.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const businessId = searchParams.get('business_id');
    const status = searchParams.get('status');
    const receiptNo = searchParams.get('receipt_no');

    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (from) { clauses.push('s.sale_date >= ?'); params.push(from); }
    if (to) { clauses.push('s.sale_date <= ?'); params.push(to); }
    if (businessId) { clauses.push('s.business_id = ?'); params.push(Number(businessId)); }
    if (status) { clauses.push('s.status = ?'); params.push(status); }
    if (receiptNo) {
      // Return/Exchange's "find a sale by Sale # / Receipt #" — deliberately
      // exempt from the cashier restriction below. A customer can return an
      // item to a different cashier than the one who originally rang it up,
      // and that cashier needs to be able to look the sale up to process it.
      clauses.push('s.receipt_no = ?'); params.push(receiptNo);
    } else if (session.role !== 'owner') {
      // The general browse/list view (Sales History) — a staff account only
      // ever sees its own sales here; the owner sees everything.
      clauses.push('s.cashier_id = ?'); params.push(session.id);
    }

    const sql = LIST_SQL_BASE + clauses.map(c => ` AND ${c}`).join('') + ' ORDER BY s.created_at DESC';
    const rows = db.prepare(sql).all(...params);
    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

interface CartItem {
  product_id?: number; quantity?: number; service_name?: string; sku?: string; amount?: number;
  is_freebie?: boolean; freebie_reason?: string;
}

// Financing providers collect the balance the store doesn't — the store
// only ever collects the downpayment (via the normal cash_amount/
// online_amount split), never the financed remainder.
const FINANCING_PROVIDERS = ['Salmon', 'Skyro', 'Billease'];

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const db = getDb();
    const {
      business_id, items, discount, additional_fee, cash_amount, online_amount, notes,
      tax_percent, service_charge, delivery_fee, payment_method, reference_no, payments,
      financing_provider, cashback_amount, downpayment_applied,
    } = await req.json();

    if (!business_id) return NextResponse.json({ error: 'Business is required' }, { status: 400 });
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Cart is empty' }, { status: 400 });
    }

    // `payments` — an unlimited-length {method, amount, reference_no} list —
    // is how Split mode and a Financing downpayment collect across more
    // than the old fixed Cash+Online pair. When present it's the sole
    // source of truth for cash_amount/online_amount below (the client's own
    // cash_amount/online_amount fields are ignored in that case, same
    // "never trust the client's totals" principle as re-pricing cart items).
    interface PaymentLeg { method: string; amount: number; reference_no: string | null; }
    const paymentLegs: PaymentLeg[] = [];
    if (Array.isArray(payments) && payments.length > 0) {
      for (const raw of payments) {
        const method = String(raw?.method ?? '').trim();
        const amount = parseFloat(String(raw?.amount));
        if (!method) return NextResponse.json({ error: 'Every payment needs a method' }, { status: 400 });
        if (!(amount > 0)) return NextResponse.json({ error: 'Every payment needs an amount greater than 0' }, { status: 400 });
        paymentLegs.push({ method, amount, reference_no: raw?.reference_no ? String(raw.reference_no).trim() || null : null });
      }
    }

    const discountNum = discount ? parseFloat(discount) : 0;
    const feeNum = additional_fee ? parseFloat(additional_fee) : 0;
    const cashNum = paymentLegs.length > 0
      ? paymentLegs.filter(l => l.method === 'Cash').reduce((s, l) => s + l.amount, 0)
      : (cash_amount ? parseFloat(cash_amount) : 0);
    const onlineNum = paymentLegs.length > 0
      ? paymentLegs.filter(l => l.method !== 'Cash').reduce((s, l) => s + l.amount, 0)
      : (online_amount ? parseFloat(online_amount) : 0);
    const cashbackNum = cashback_amount ? parseFloat(cashback_amount) : 0;
    const downpaymentAppliedNum = downpayment_applied ? parseFloat(downpayment_applied) : 0;
    const taxPercentNum = tax_percent ? parseFloat(tax_percent) : 0;
    const serviceChargeNum = service_charge ? parseFloat(service_charge) : 0;
    const deliveryFeeNum = delivery_fee ? parseFloat(delivery_fee) : 0;

    if (cashNum < 0 || onlineNum < 0 || cashbackNum < 0 || downpaymentAppliedNum < 0) {
      return NextResponse.json({ error: 'Payment amounts cannot be negative' }, { status: 400 });
    }

    // With payments[] present, the free-text payment_method label is
    // derived from the actual distinct methods used ("Cash + GCash + Bank
    // Transfer") rather than trusted from the client — same principle as
    // amounts above.
    const derivedPaymentMethod = paymentLegs.length > 0
      ? [...new Set(paymentLegs.map(l => l.method))].join(' + ')
      : (payment_method?.trim() || null);

    // Re-price and re-check stock server-side for every line — the cart's
    // own numbers are never trusted, same principle used for Service Center
    // repairs and Expense amounts this session.
    const getProduct = db.prepare('SELECT p.id, p.name, p.sku, p.srp, p.cogs, COALESCE(i.quantity,0) as quantity FROM products p LEFT JOIN inventory i ON i.product_id = p.id WHERE p.id = ?');
    const allowZeroStockRow = db.prepare(`SELECT value FROM app_settings WHERE key = 'pos_allow_zero_stock'`).get() as { value: string } | undefined;
    const allowZeroStock = allowZeroStockRow?.value === '1';

    const lineData: {
      product_id: number | null; name: string; sku: string | null; unit_price: number; cogs: number;
      quantity: number; line_total: number; is_freebie: boolean; original_price: number | null; freebie_reason: string | null;
    }[] = [];
    for (const raw of items as CartItem[]) {
      // Service/fee lines (Labor Fee, Reservation Fee) carry no product_id —
      // there's no canonical backend price to re-derive, so the client-entered
      // amount is trusted here the same way discount/additional_fee/etc already are.
      if (raw?.service_name) {
        const amount = parseFloat(String(raw.amount));
        if (!(amount > 0)) {
          return NextResponse.json({ error: 'Invalid service/fee amount in cart' }, { status: 400 });
        }
        lineData.push({
          product_id: null, name: String(raw.service_name), sku: raw.sku ?? null,
          unit_price: amount, cogs: 0, quantity: 1, line_total: amount,
          is_freebie: false, original_price: null, freebie_reason: null,
        });
        continue;
      }

      const qty = parseInt(String(raw?.quantity), 10);
      if (!raw?.product_id || !qty || qty <= 0) {
        return NextResponse.json({ error: 'Invalid item in cart' }, { status: 400 });
      }
      const product = getProduct.get(raw.product_id) as
        { id: number; name: string; sku: string | null; srp: number | null; cogs: number | null; quantity: number } | undefined;
      if (!product) {
        return NextResponse.json({ error: `Product #${raw.product_id} no longer exists` }, { status: 400 });
      }
      if (!allowZeroStock && qty > product.quantity) {
        return NextResponse.json({
          error: `Not enough stock for "${product.name}" — only ${product.quantity} left, tried to sell ${qty}.`,
        }, { status: 400 });
      }
      // Freebie: selling price is forced to 0 (never trusted from the client
      // as a raw override — only the boolean flag is), but cogs stays the
      // real product cost below, same as any other line. original_price is
      // re-derived from the product's own SRP, never taken from the client,
      // so it can't be spoofed into an inflated "was worth this much" figure.
      const isFreebie = !!raw?.is_freebie;
      const unitPrice = isFreebie ? 0 : (product.srp ?? 0);
      lineData.push({
        product_id: product.id, name: product.name, sku: product.sku,
        unit_price: unitPrice, cogs: product.cogs ?? 0, quantity: qty, line_total: unitPrice * qty,
        is_freebie: isFreebie, original_price: isFreebie ? (product.srp ?? 0) : null,
        freebie_reason: isFreebie ? (String(raw?.freebie_reason ?? '').trim() || null) : null,
      });
    }

    const subtotal = lineData.reduce((s, l) => s + l.line_total, 0);
    const preTax = Math.max(0, subtotal - discountNum + feeNum);
    const taxAmount = preTax * (taxPercentNum / 100);
    // `total` is the Net Sale value — untouched by cashback/downpayment, so
    // every existing report (Gross Sales, Net Income, Payment Method Report,
    // COGS, etc.) keeps reflecting the transaction's true value rather than
    // the smaller amount actually collected today.
    const total = Math.max(0, preTax + taxAmount + serviceChargeNum + deliveryFeeNum);

    // Cashback Redeemed (loyalty value used) and Downpayment/Reservation
    // Applied (money the store already collected in an earlier, separate
    // transaction) are deductions against what's owed today — not payment
    // legs, and not discounts. Amount Due is what every payment mode below
    // (including Financing) is actually validated and paid against.
    if (cashbackNum + downpaymentAppliedNum > total + 0.005) {
      return NextResponse.json({ error: 'Cashback Redeemed and Downpayment Applied cannot exceed the total.' }, { status: 400 });
    }
    const amountDue = Math.max(0, total - cashbackNum - downpaymentAppliedNum);
    const totalPayment = cashNum + onlineNum;

    // Financing sales are expected to fall short of `amountDue` in cash+
    // online — the shortfall is covered by the financing provider, not the
    // customer today — so they're validated on their own terms instead of
    // the normal "payment must cover the total" rule. financing_amount is
    // always recomputed here (never trusted from the client), same
    // principle as re-pricing cart items server-side above.
    let financingProviderVal: string | null = null;
    let financingAmountVal = 0;
    let financingReferenceVal: string | null = null;
    let financingStatusVal: string | null = null;
    if (financing_provider) {
      if (!FINANCING_PROVIDERS.includes(financing_provider)) {
        return NextResponse.json({ error: 'Invalid financing provider' }, { status: 400 });
      }
      if (totalPayment > amountDue + 0.005) {
        return NextResponse.json({ error: 'Downpayment cannot exceed the amount due' }, { status: 400 });
      }
      if (!reference_no || !String(reference_no).trim()) {
        return NextResponse.json({ error: 'Financing reference/application number is required' }, { status: 400 });
      }
      financingProviderVal = financing_provider;
      financingAmountVal = Math.max(0, amountDue - totalPayment);
      financingReferenceVal = String(reference_no).trim();
      financingStatusVal = 'Pending';
    } else if (totalPayment + 0.005 < amountDue) {
      return NextResponse.json({ error: 'Payment is less than the amount due' }, { status: 400 });
    }
    // Financing sales never show "change" — the shortfall is by design,
    // covered by the financing provider, not money owed back or forward.
    const changeDue = financing_provider ? 0 : totalPayment - amountDue;

    // A sale is now REQUIRED to belong to an open shift — a sale rung up
    // with no active shift used to complete fine with shift_id left NULL,
    // which meant its cash was physically collected but never counted
    // toward that (or any) shift's Expected Cash, showing up later as a
    // confusing, unexplained "OVER" discrepancy at End Shift with no
    // record of where the extra cash came from.
    const openShift = db.prepare(
      `SELECT id FROM pos_shifts WHERE business_id = ? AND cashier_id = ? AND status = 'Open'`
    ).get(business_id, session.id) as { id: number } | undefined;
    if (!openShift) {
      return NextResponse.json({ error: 'You need to Start Shift before completing a sale.' }, { status: 400 });
    }

    const insertSale = db.prepare(`
      INSERT INTO pos_sales
        (business_id, sale_date, subtotal, discount, additional_fee, tax_percent, tax_amount,
         service_charge, delivery_fee, total, cash_amount, online_amount, change_due,
         payment_method, reference_no, status, cashier_id, notes, shift_id,
         financing_provider, financing_amount, financing_reference, financing_status, cashback_amount,
         downpayment_applied, receipt_no)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'Completed', ?, ?, ?, ?,?,?,?,?,?,?)
    `);
    const insertItem = db.prepare(`
      INSERT INTO pos_sale_items (sale_id, product_id, product_name, sku, unit_price, cogs, quantity, line_total, is_freebie, original_price, freebie_reason)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `);
    const insertMovement = db.prepare(`
      INSERT INTO stock_movements (product_id, type, quantity, note, moved_at) VALUES (?, 'OUT', ?, ?, datetime('now'))
    `);
    const adjustInventory = db.prepare(`
      INSERT INTO inventory (product_id, quantity, last_updated)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(product_id) DO UPDATE SET
        quantity = quantity + excluded.quantity,
        last_updated = datetime('now')
    `);
    const insertPayment = db.prepare(`
      INSERT INTO pos_sale_payments (sale_id, method, amount, reference_no) VALUES (?,?,?,?)
    `);

    const saleId = runTransaction(() => {
      const info = insertSale.run(
        business_id, todayISO(), subtotal, discountNum, feeNum, taxPercentNum, taxAmount,
        serviceChargeNum, deliveryFeeNum, total, cashNum, onlineNum, changeDue,
        derivedPaymentMethod, reference_no?.trim() || null,
        session.id, notes?.trim() || null, openShift?.id ?? null,
        financingProviderVal, financingAmountVal, financingReferenceVal, financingStatusVal, cashbackNum,
        downpaymentAppliedNum, nextReceiptNo(db),
      );
      const id = Number(info.lastInsertRowid);
      for (const l of lineData) {
        insertItem.run(id, l.product_id, l.name, l.sku, l.unit_price, l.cogs, l.quantity, l.line_total, l.is_freebie ? 1 : 0, l.original_price, l.freebie_reason);
        // Freebies still deduct inventory — they're given away, not sold,
        // but the store still physically hands over real stock.
        if (l.product_id != null) {
          insertMovement.run(l.product_id, l.quantity, l.is_freebie ? `POS Sale #${id} (Freebie)` : `POS Sale #${id}`);
          adjustInventory.run(l.product_id, -l.quantity);
        }
      }
      for (const leg of paymentLegs) {
        insertPayment.run(id, leg.method, leg.amount, leg.reference_no);
      }
      return id;
    });

    return NextResponse.json({ id: saleId, subtotal, total, amount_due: amountDue, change_due: changeDue }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
