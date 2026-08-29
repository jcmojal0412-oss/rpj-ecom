import { NextRequest, NextResponse } from 'next/server';
import { getDb, runTransaction } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

interface BackfillItem { product_id?: number; service_name?: string; quantity: number; unit_price: number; }

// Creates a stand-in sale record for a purchase that happened before this
// POS was in use (or that fell outside the historical Excel import) so it
// can go through the exact same Refund/Exchange flow as any real sale —
// see /api/pos/sales/[id]/refund and /exchange, both untouched by this.
//
// Deliberately does NOT touch stock_movements/inventory or a shift: the
// item was already sold in real life, outside this system, so recording it
// now must not deduct stock a second time or affect any cash drawer. Only
// the *return* half of a later Refund/Exchange (which restocks/deducts
// normally) actually moves real inventory — correct, since that part is
// happening for real, today.
//
// Owner-only to create: unlike a refund against a real, already-recorded
// sale, this record is backed by nothing but what's typed in here, so it's
// a materially easier vector to fabricate a refund payout against. A note
// explaining the source (old receipt, customer's memory, etc.) is required
// for the same reason.
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    if (session.role !== 'owner') return NextResponse.json({ error: 'Only the owner can backfill a sale not in the system' }, { status: 403 });

    const db = getDb();
    const { business_id, sale_date, items, note } = await req.json();

    if (!business_id) return NextResponse.json({ error: 'Business is required' }, { status: 400 });
    if (!sale_date || !/^\d{4}-\d{2}-\d{2}$/.test(sale_date)) {
      return NextResponse.json({ error: 'A valid sale date is required' }, { status: 400 });
    }
    const todayStr = new Date().toISOString().slice(0, 10);
    if (sale_date > todayStr) return NextResponse.json({ error: 'Sale date cannot be in the future' }, { status: 400 });
    const noteTrimmed = String(note ?? '').trim();
    if (!noteTrimmed) return NextResponse.json({ error: 'A note explaining this backfilled sale is required' }, { status: 400 });
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'At least one item is required' }, { status: 400 });
    }

    const getProduct = db.prepare('SELECT id, name, sku, cogs FROM products WHERE id = ?');
    const lineData: { product_id: number | null; name: string; sku: string | null; unit_price: number; cogs: number; quantity: number; line_total: number }[] = [];
    for (const raw of items as BackfillItem[]) {
      const qty = parseInt(String(raw.quantity), 10);
      // Unlike a live sale, price isn't re-derived from the product's
      // current SRP — it's whatever the cashier recalls the customer
      // actually paid, which may differ from today's price. Only sanity
      // checked, not overridden.
      const unitPrice = parseFloat(String(raw.unit_price));
      if (!qty || qty <= 0) return NextResponse.json({ error: 'Every item needs a quantity greater than 0' }, { status: 400 });
      if (!Number.isFinite(unitPrice) || unitPrice < 0) return NextResponse.json({ error: 'Every item needs a valid, non-negative price' }, { status: 400 });

      // Labor/service fees (Labor Fee, Reservation Fee) carry no product_id
      // — same as a live sale's service lines — there's no catalog price to
      // re-derive or stock to worry about, just a name and what was paid.
      if (raw.service_name) {
        const serviceName = String(raw.service_name).trim();
        if (!serviceName) return NextResponse.json({ error: 'Every service/fee item needs a name' }, { status: 400 });
        lineData.push({
          product_id: null, name: serviceName, sku: null,
          unit_price: unitPrice, cogs: 0, quantity: qty, line_total: unitPrice * qty,
        });
        continue;
      }

      const productId = Number(raw.product_id);
      if (!productId) return NextResponse.json({ error: 'Every item needs a product' }, { status: 400 });

      const product = getProduct.get(productId) as { id: number; name: string; sku: string | null; cogs: number | null } | undefined;
      if (!product) return NextResponse.json({ error: `Product #${productId} not found` }, { status: 400 });

      lineData.push({
        product_id: product.id, name: product.name, sku: product.sku,
        unit_price: unitPrice, cogs: product.cogs ?? 0, quantity: qty, line_total: unitPrice * qty,
      });
    }

    const subtotal = lineData.reduce((s, l) => s + l.line_total, 0);

    const insertSale = db.prepare(`
      INSERT INTO pos_sales
        (business_id, sale_date, subtotal, discount, additional_fee, tax_percent, tax_amount,
         service_charge, delivery_fee, total, cash_amount, online_amount, change_due,
         payment_method, status, cashier_id, notes)
      VALUES (?,?,?,0,0,0,0,0,0,?,0,0,0,NULL,'Completed',?,?)
    `);
    const insertItem = db.prepare(`
      INSERT INTO pos_sale_items (sale_id, product_id, product_name, sku, unit_price, cogs, quantity, line_total)
      VALUES (?,?,?,?,?,?,?,?)
    `);

    const saleId = runTransaction(() => {
      const info = insertSale.run(
        business_id, sale_date, subtotal, subtotal, session.id,
        `Backfilled — sale not originally recorded: ${noteTrimmed}`,
      );
      const id = Number(info.lastInsertRowid);
      for (const l of lineData) {
        insertItem.run(id, l.product_id, l.name, l.sku, l.unit_price, l.cogs, l.quantity, l.line_total);
      }
      return id;
    });

    return NextResponse.json({ id: saleId }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
