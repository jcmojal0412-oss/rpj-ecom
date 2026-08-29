import { NextRequest, NextResponse } from 'next/server';
import { getDb, runTransaction } from '@/lib/db';
import { IN_REASONS, OUT_REASONS } from '@/components/inventory/constants';

export const dynamic = 'force-dynamic';

interface BulkItem { product_id: number; quantity: number; unit_cost?: number; }

// Thrown inside the transaction for a bad row (missing product, insufficient
// stock, etc.) — distinguished from a genuinely unexpected exception (DB
// error) so the response status reflects which one actually happened.
class ValidationError extends Error {}

export async function POST(req: NextRequest) {
  try {
    const db = getDb();
    const { type, reason, note, moved_at, items } = await req.json();

    if (!['IN', 'OUT'].includes(type)) {
      return NextResponse.json({ error: 'type must be IN or OUT' }, { status: 400 });
    }
    const validReasons = type === 'IN' ? IN_REASONS : OUT_REASONS;
    if (!validReasons.includes(reason)) {
      return NextResponse.json({ error: 'A valid Reason is required' }, { status: 400 });
    }
    const noteTrimmed = String(note ?? '').trim();
    if (reason === 'Other' && !noteTrimmed) {
      return NextResponse.json({ error: 'Note is required when Reason is Other' }, { status: 400 });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'At least one item is required' }, { status: 400 });
    }

    // Same-product-twice-in-one-batch is almost certainly a mis-click (two
    // separate rows for one SKU), not a genuine intent to apply two
    // different quantities — reject outright rather than silently summing
    // or only applying the last one.
    const seen = new Set<number>();
    for (const raw of items as BulkItem[]) {
      const pid = Number(raw.product_id);
      if (seen.has(pid)) {
        return NextResponse.json({ error: 'The same product appears in more than one row — combine them into a single row.' }, { status: 400 });
      }
      seen.add(pid);
    }

    const composedNote = noteTrimmed ? `${reason}: ${noteTrimmed}` : reason;
    const movedAt = moved_at || new Date().toISOString();

    const results = runTransaction(() => {
      const out: { product_id: number; sku: string; product_name: string; previous_stock: number; new_stock: number; quantity: number }[] = [];

      for (const raw of items as BulkItem[]) {
        const productId = Number(raw.product_id);
        const qty = parseInt(String(raw.quantity), 10);
        if (!productId) throw new ValidationError('Every row needs a product');
        if (!qty || qty <= 0) throw new ValidationError('Every row needs a quantity greater than 0');

        const product = db.prepare('SELECT id, name, sku, cogs FROM products WHERE id = ?').get(productId) as
          { id: number; name: string; sku: string; cogs: number | null } | undefined;
        if (!product) throw new ValidationError(`Product #${productId} not found`);

        const invRow = db.prepare('SELECT quantity FROM inventory WHERE product_id = ?').get(productId) as { quantity: number } | undefined;
        const currentStock = invRow?.quantity ?? 0;

        if (type === 'OUT' && qty > currentStock) {
          throw new ValidationError(`${product.sku} — Insufficient stock. Available: ${currentStock} pcs, requested: ${qty} pcs.`);
        }

        let costNum: number | undefined;
        if (type === 'IN' && raw.unit_cost != null && String(raw.unit_cost).trim() !== '') {
          costNum = parseFloat(String(raw.unit_cost));
          if (!Number.isFinite(costNum) || costNum < 0) {
            throw new ValidationError(`${product.sku} — Cost per Unit must be a valid, non-negative number`);
          }
        }

        const delta = type === 'IN' ? qty : -qty;
        db.prepare(
          'INSERT INTO stock_movements (product_id, type, quantity, note, moved_at) VALUES (?,?,?,?,?)'
        ).run(productId, type, qty, composedNote, movedAt);
        db.prepare(`
          INSERT INTO inventory (product_id, quantity, last_updated)
          VALUES (?, ?, datetime('now'))
          ON CONFLICT(product_id) DO UPDATE SET
            quantity = quantity + excluded.quantity,
            last_updated = datetime('now')
        `).run(productId, delta);
        if (type === 'IN' && costNum != null) {
          db.prepare('UPDATE products SET cogs=? WHERE id=?').run(costNum, productId);
        }

        out.push({ product_id: productId, sku: product.sku, product_name: product.name, previous_stock: currentStock, new_stock: currentStock + delta, quantity: qty });
      }

      return out;
    });

    return NextResponse.json({ ok: true, type, reason, count: results.length, items: results }, { status: 201 });
  } catch (e) {
    if (e instanceof ValidationError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
