import { NextRequest, NextResponse } from 'next/server';
import { getDb, runTransaction } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { todayISO } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const LIST_SQL_BASE = `
  SELECT s.*, b.name as business_name, u.name as cashier_name
  FROM pos_sales s
  LEFT JOIN businesses b ON b.id = s.business_id
  LEFT JOIN users u ON u.id = s.cashier_id
  WHERE 1=1
`;

export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const { searchParams } = new URL(req.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const businessId = searchParams.get('business_id');
    const status = searchParams.get('status');

    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (from) { clauses.push('s.sale_date >= ?'); params.push(from); }
    if (to) { clauses.push('s.sale_date <= ?'); params.push(to); }
    if (businessId) { clauses.push('s.business_id = ?'); params.push(Number(businessId)); }
    if (status) { clauses.push('s.status = ?'); params.push(status); }

    const sql = LIST_SQL_BASE + clauses.map(c => ` AND ${c}`).join('') + ' ORDER BY s.created_at DESC';
    const rows = db.prepare(sql).all(...params);
    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

interface CartItem { product_id?: number; quantity?: number; service_name?: string; sku?: string; amount?: number; }

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
      tax_percent, service_charge, delivery_fee, payment_method, reference_no,
      financing_provider,
    } = await req.json();

    if (!business_id) return NextResponse.json({ error: 'Business is required' }, { status: 400 });
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Cart is empty' }, { status: 400 });
    }

    const discountNum = discount ? parseFloat(discount) : 0;
    const feeNum = additional_fee ? parseFloat(additional_fee) : 0;
    const cashNum = cash_amount ? parseFloat(cash_amount) : 0;
    const onlineNum = online_amount ? parseFloat(online_amount) : 0;
    const taxPercentNum = tax_percent ? parseFloat(tax_percent) : 0;
    const serviceChargeNum = service_charge ? parseFloat(service_charge) : 0;
    const deliveryFeeNum = delivery_fee ? parseFloat(delivery_fee) : 0;

    if (cashNum < 0 || onlineNum < 0) {
      return NextResponse.json({ error: 'Payment amounts cannot be negative' }, { status: 400 });
    }

    // Re-price and re-check stock server-side for every line — the cart's
    // own numbers are never trusted, same principle used for Service Center
    // repairs and Expense amounts this session.
    const getProduct = db.prepare('SELECT p.id, p.name, p.sku, p.srp, p.cogs, COALESCE(i.quantity,0) as quantity FROM products p LEFT JOIN inventory i ON i.product_id = p.id WHERE p.id = ?');

    const lineData: { product_id: number | null; name: string; sku: string | null; unit_price: number; cogs: number; quantity: number; line_total: number }[] = [];
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
      if (qty > product.quantity) {
        return NextResponse.json({
          error: `Not enough stock for "${product.name}" — only ${product.quantity} left, tried to sell ${qty}.`,
        }, { status: 400 });
      }
      const unitPrice = product.srp ?? 0;
      lineData.push({
        product_id: product.id, name: product.name, sku: product.sku,
        unit_price: unitPrice, cogs: product.cogs ?? 0, quantity: qty, line_total: unitPrice * qty,
      });
    }

    const subtotal = lineData.reduce((s, l) => s + l.line_total, 0);
    const preTax = Math.max(0, subtotal - discountNum + feeNum);
    const taxAmount = preTax * (taxPercentNum / 100);
    const total = Math.max(0, preTax + taxAmount + serviceChargeNum + deliveryFeeNum);
    const totalPayment = cashNum + onlineNum;

    // Financing sales are expected to fall short of `total` in cash+online —
    // the shortfall is covered by the financing provider, not the customer
    // today — so they're validated on their own terms instead of the normal
    // "payment must cover the total" rule. financing_amount is always
    // recomputed here (never trusted from the client), same principle as
    // re-pricing cart items server-side above.
    let financingProviderVal: string | null = null;
    let financingAmountVal = 0;
    let financingReferenceVal: string | null = null;
    let financingStatusVal: string | null = null;
    if (financing_provider) {
      if (!FINANCING_PROVIDERS.includes(financing_provider)) {
        return NextResponse.json({ error: 'Invalid financing provider' }, { status: 400 });
      }
      if (totalPayment > total + 0.005) {
        return NextResponse.json({ error: 'Downpayment cannot exceed the total purchase amount' }, { status: 400 });
      }
      if (!reference_no || !String(reference_no).trim()) {
        return NextResponse.json({ error: 'Financing reference/application number is required' }, { status: 400 });
      }
      financingProviderVal = financing_provider;
      financingAmountVal = Math.max(0, total - totalPayment);
      financingReferenceVal = String(reference_no).trim();
      financingStatusVal = 'Pending';
    } else if (totalPayment + 0.005 < total) {
      return NextResponse.json({ error: 'Payment is less than the total due' }, { status: 400 });
    }
    // Financing sales never show "change" — the shortfall is by design,
    // covered by the financing provider, not money owed back or forward.
    const changeDue = financing_provider ? 0 : totalPayment - total;

    // Auto-tag with the cashier's currently open shift for this business, if
    // any — starting a shift is optional, so this is NULL (and everything
    // still works exactly as before) when the cashier hasn't started one.
    const openShift = db.prepare(
      `SELECT id FROM pos_shifts WHERE business_id = ? AND cashier_id = ? AND status = 'Open'`
    ).get(business_id, session.id) as { id: number } | undefined;

    const insertSale = db.prepare(`
      INSERT INTO pos_sales
        (business_id, sale_date, subtotal, discount, additional_fee, tax_percent, tax_amount,
         service_charge, delivery_fee, total, cash_amount, online_amount, change_due,
         payment_method, reference_no, status, cashier_id, notes, shift_id,
         financing_provider, financing_amount, financing_reference, financing_status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'Completed', ?, ?, ?, ?,?,?,?)
    `);
    const insertItem = db.prepare(`
      INSERT INTO pos_sale_items (sale_id, product_id, product_name, sku, unit_price, cogs, quantity, line_total)
      VALUES (?,?,?,?,?,?,?,?)
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

    const saleId = runTransaction(() => {
      const info = insertSale.run(
        business_id, todayISO(), subtotal, discountNum, feeNum, taxPercentNum, taxAmount,
        serviceChargeNum, deliveryFeeNum, total, cashNum, onlineNum, changeDue,
        payment_method?.trim() || null, reference_no?.trim() || null,
        session.id, notes?.trim() || null, openShift?.id ?? null,
        financingProviderVal, financingAmountVal, financingReferenceVal, financingStatusVal,
      );
      const id = Number(info.lastInsertRowid);
      for (const l of lineData) {
        insertItem.run(id, l.product_id, l.name, l.sku, l.unit_price, l.cogs, l.quantity, l.line_total);
        if (l.product_id != null) {
          insertMovement.run(l.product_id, l.quantity, `POS Sale #${id}`);
          adjustInventory.run(l.product_id, -l.quantity);
        }
      }
      return id;
    });

    return NextResponse.json({ id: saleId, subtotal, total, change_due: changeDue }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
