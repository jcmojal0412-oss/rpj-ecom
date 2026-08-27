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

interface CartItem { product_id: number; quantity: number; }

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const db = getDb();
    const {
      business_id, items, discount, additional_fee, cash_amount, online_amount, notes,
    } = await req.json();

    if (!business_id) return NextResponse.json({ error: 'Business is required' }, { status: 400 });
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Cart is empty' }, { status: 400 });
    }

    const discountNum = discount ? parseFloat(discount) : 0;
    const feeNum = additional_fee ? parseFloat(additional_fee) : 0;
    const cashNum = cash_amount ? parseFloat(cash_amount) : 0;
    const onlineNum = online_amount ? parseFloat(online_amount) : 0;

    // Re-price and re-check stock server-side for every line — the cart's
    // own numbers are never trusted, same principle used for Service Center
    // repairs and Expense amounts this session.
    const getProduct = db.prepare('SELECT p.id, p.name, p.sku, p.srp, COALESCE(i.quantity,0) as quantity FROM products p LEFT JOIN inventory i ON i.product_id = p.id WHERE p.id = ?');

    const lineData: { product_id: number; name: string; sku: string | null; unit_price: number; quantity: number; line_total: number }[] = [];
    for (const raw of items as CartItem[]) {
      const qty = parseInt(String(raw?.quantity), 10);
      if (!raw?.product_id || !qty || qty <= 0) {
        return NextResponse.json({ error: 'Invalid item in cart' }, { status: 400 });
      }
      const product = getProduct.get(raw.product_id) as
        { id: number; name: string; sku: string | null; srp: number | null; quantity: number } | undefined;
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
        unit_price: unitPrice, quantity: qty, line_total: unitPrice * qty,
      });
    }

    const subtotal = lineData.reduce((s, l) => s + l.line_total, 0);
    const total = Math.max(0, subtotal - discountNum + feeNum);
    const totalPayment = cashNum + onlineNum;
    if (totalPayment + 0.005 < total) {
      return NextResponse.json({ error: 'Payment is less than the total due' }, { status: 400 });
    }
    const changeDue = totalPayment - total;

    const insertSale = db.prepare(`
      INSERT INTO pos_sales
        (business_id, sale_date, subtotal, discount, additional_fee, total,
         cash_amount, online_amount, change_due, status, cashier_id, notes)
      VALUES (?,?,?,?,?,?,?,?,?, 'Completed', ?, ?)
    `);
    const insertItem = db.prepare(`
      INSERT INTO pos_sale_items (sale_id, product_id, product_name, sku, unit_price, quantity, line_total)
      VALUES (?,?,?,?,?,?,?)
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
        business_id, todayISO(), subtotal, discountNum, feeNum, total,
        cashNum, onlineNum, changeDue, session.id, notes?.trim() || null,
      );
      const id = Number(info.lastInsertRowid);
      for (const l of lineData) {
        insertItem.run(id, l.product_id, l.name, l.sku, l.unit_price, l.quantity, l.line_total);
        insertMovement.run(l.product_id, l.quantity, `POS Sale #${id}`);
        adjustInventory.run(l.product_id, -l.quantity);
      }
      return id;
    });

    return NextResponse.json({ id: saleId, subtotal, total, change_due: changeDue }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
