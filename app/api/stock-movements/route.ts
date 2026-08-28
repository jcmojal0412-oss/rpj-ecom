import { NextRequest, NextResponse } from 'next/server';
import { getDb, runTransaction } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const { searchParams } = req.nextUrl;
    const productId = searchParams.get('product_id');
    const date      = searchParams.get('date');
    const days      = searchParams.get('days') ?? '7';

    let sql = `
      SELECT sm.*, p.sku, p.name
      FROM stock_movements sm
      JOIN products p ON p.id = sm.product_id
      WHERE sm.moved_at >= datetime('now', '-${parseInt(days)} days')
    `;
    const args: (string | number)[] = [];

    if (productId) { sql += ' AND sm.product_id=?'; args.push(productId); }
    if (date)      { sql += ' AND date(sm.moved_at)=?'; args.push(date); }
    sql += ' ORDER BY sm.moved_at DESC LIMIT 500';

    const rows = db.prepare(sql).all(...args);
    return NextResponse.json(rows);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

const IN_REASONS = ['New Purchase / Restock', 'Customer Return', 'RTS (Return to Sender)', 'Transfer In', 'Inventory Adjustment', 'Other'];
const OUT_REASONS = ['Damaged / Defective', 'Supplier Return', 'Transfer Out', 'Inventory Adjustment', 'Internal Use', 'Other'];

export async function POST(req: NextRequest) {
  try {
    const db = getDb();
    const { product_id, type, quantity, reason, note, moved_at, unit_cost } = await req.json();

    if (!['IN', 'OUT'].includes(type)) {
      return NextResponse.json({ error: 'type must be IN or OUT' }, { status: 400 });
    }
    if (!product_id) return NextResponse.json({ error: 'Product is required' }, { status: 400 });
    const qty = parseInt(String(quantity), 10);
    if (!qty || qty <= 0) return NextResponse.json({ error: 'Quantity must be greater than 0' }, { status: 400 });
    const validReasons = type === 'IN' ? IN_REASONS : OUT_REASONS;
    if (!validReasons.includes(reason)) {
      return NextResponse.json({ error: 'A valid Reason is required' }, { status: 400 });
    }
    const noteTrimmed = String(note ?? '').trim();
    if (reason === 'Other' && !noteTrimmed) {
      return NextResponse.json({ error: 'Note is required when Reason is Other' }, { status: 400 });
    }

    // Stock OUT never touches COGS — unit_cost is simply ignored for OUT,
    // same as the client already hides the field for that mode.
    let costNum: number | undefined;
    if (type === 'IN' && unit_cost != null && String(unit_cost).trim() !== '') {
      costNum = parseFloat(unit_cost);
      if (!Number.isFinite(costNum) || costNum < 0) {
        return NextResponse.json({ error: 'Cost per Unit must be a valid, non-negative number' }, { status: 400 });
      }
    }

    const product = db.prepare('SELECT id, name, sku, cogs FROM products WHERE id = ?').get(product_id) as
      { id: number; name: string; sku: string; cogs: number | null } | undefined;
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

    const invRow = db.prepare('SELECT quantity FROM inventory WHERE product_id = ?').get(product_id) as { quantity: number } | undefined;
    const currentStock = invRow?.quantity ?? 0;

    // No setting anywhere in this app opts into negative inventory — a
    // manual Stock OUT that outruns what's on hand gets rejected outright,
    // same as every other stock-reducing path this session (POS sale,
    // exchange) already re-checks availability server-side.
    if (type === 'OUT' && qty > currentStock) {
      return NextResponse.json({
        error: `Insufficient stock. Available: ${currentStock} pcs, requested: ${qty} pcs.`,
        available: currentStock, requested: qty,
      }, { status: 400 });
    }

    const composedNote = noteTrimmed ? `${reason}: ${noteTrimmed}` : reason;
    const previousCogs = product.cogs ?? 0;

    const newStock = runTransaction(() => {
      const delta = type === 'IN' ? qty : -qty;
      db.prepare(
        'INSERT INTO stock_movements (product_id, type, quantity, note, moved_at) VALUES (?,?,?,?,?)'
      ).run(product_id, type, qty, composedNote, moved_at || new Date().toISOString());
      // Upsert: a plain UPDATE silently affects zero rows if a product is
      // somehow missing its inventory row, logging the movement but never
      // creating the actual stock count. INSERT..ON CONFLICT guarantees the
      // row exists either way.
      db.prepare(`
        INSERT INTO inventory (product_id, quantity, last_updated)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(product_id) DO UPDATE SET
          quantity = quantity + excluded.quantity,
          last_updated = datetime('now')
      `).run(product_id, delta);
      // Restocking at a new cost updates the product's COGS going forward —
      // simple override, same as the Purchase Orders receiving flow.
      if (type === 'IN' && costNum != null) {
        db.prepare('UPDATE products SET cogs=? WHERE id=?').run(costNum, product_id);
      }
      return currentStock + delta;
    });

    return NextResponse.json({
      ok: true, product_name: product.name, sku: product.sku, type, reason,
      previous_stock: currentStock, new_stock: newStock, quantity: qty,
      previous_cogs: previousCogs, new_cogs: costNum ?? previousCogs,
    }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
