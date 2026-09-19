import { NextRequest, NextResponse } from 'next/server';
import { getDb, runTransaction } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { logInventoryCount } from '@/lib/inventory-count';
import { COUNT_REASONS } from '@/components/inventory/constants';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const lowStock = req.nextUrl.searchParams.get('low_stock') === '1';

    let sql = `
      SELECT p.id, p.sku, p.name, p.category, p.cogs, p.srp, p.reorder_point,
             COALESCE(i.quantity, 0) as quantity, i.last_updated
      FROM products p
      LEFT JOIN inventory i ON i.product_id = p.id
    `;
    if (lowStock) {
      // Show critical (below reorder) + watch list (within 2x reorder), max 10, ordered by urgency
      sql += ` WHERE COALESCE(i.quantity,0) <= (p.reorder_point * 2)
               ORDER BY COALESCE(i.quantity,0) ASC
               LIMIT 10`;
    } else {
      sql += ' ORDER BY p.sku';
    }

    const rows = db.prepare(sql).all();
    return NextResponse.json(rows);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// Physical count — sets the quantity to the exact number counted. Every
// count is recorded in inventory_counts (expected vs counted, who, why) and,
// when it differs, also as a stock_movements row so the movement history
// still reconciles. `expected_quantity` is what the counter was shown; if
// stock moved since (a sale rang up mid-count), the count is rejected so
// nobody adjusts against a number that's no longer true.
export async function PUT(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || (session.role !== 'owner' && !session.permissions.includes('inventory'))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const db = getDb();
    const { product_id, quantity, expected_quantity, reason, note } = await req.json();

    const counted = Number(quantity);
    if (!product_id || quantity == null || !Number.isInteger(counted) || counted < 0) {
      return NextResponse.json({ error: 'product_id and a non-negative whole-number quantity are required' }, { status: 400 });
    }

    const product = db.prepare('SELECT id, cogs FROM products WHERE id = ?').get(product_id) as { id: number; cogs: number | null } | undefined;
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

    // Read and write with no await in between, so a concurrent sale can't
    // slip in after the stale-check but before the write.
    const current = (db.prepare('SELECT COALESCE(quantity,0) as q FROM inventory WHERE product_id=?').get(product_id) as { q: number } | undefined)?.q ?? 0;
    if (expected_quantity != null && Number(expected_quantity) !== current) {
      return NextResponse.json({
        error: `Stock changed while you were counting — the system now shows ${current}. Please recount.`,
        current,
      }, { status: 409 });
    }

    const delta = counted - current;
    const reasonStr = String(reason ?? '').trim();
    const noteStr = String(note ?? '').trim();
    if (delta !== 0) {
      if (!COUNT_REASONS.includes(reasonStr)) {
        return NextResponse.json({ error: 'A reason is required when the count differs from the system.' }, { status: 400 });
      }
      if (reasonStr === 'Other' && !noteStr) {
        return NextResponse.json({ error: 'A note is required when the reason is Other.' }, { status: 400 });
      }
    }

    runTransaction(() => {
      db.prepare(`
        INSERT INTO inventory (product_id, quantity, last_updated)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(product_id) DO UPDATE SET quantity = ?, last_updated = datetime('now')
      `).run(product_id, counted, counted);

      if (delta !== 0) {
        const movementNote = `Physical Count: ${reasonStr}${noteStr ? `: ${noteStr}` : ''}`;
        db.prepare(
          "INSERT INTO stock_movements (product_id, type, quantity, note, moved_at) VALUES (?,?,?,?,datetime('now'))"
        ).run(product_id, delta > 0 ? 'IN' : 'OUT', Math.abs(delta), movementNote);
      }

      logInventoryCount(db, {
        productId: product.id, expected: current, counted, unitCost: product.cogs ?? 0,
        reason: delta !== 0 ? reasonStr : null, note: noteStr || null, source: 'single', countedBy: session.id,
      });
    });

    return NextResponse.json({ ok: true, expected: current, counted, variance: delta });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
