import { NextRequest, NextResponse } from 'next/server';
import { getDb, runTransaction } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { logSaleAudit } from '@/lib/pos-audit';

export const dynamic = 'force-dynamic';

interface ReleaseLine { sale_item_id: number; serial_number?: string; imei_1?: string; imei_2?: string; }

// Hands over a FOR PICKUP sale's item(s) — the customer already paid on the
// original sale date (see app/api/pos/sales/route.ts); this endpoint NEVER
// inserts into pos_sales or pos_sale_items, only UPDATEs the existing row,
// so it is structurally incapable of creating a second sale no matter how
// it's called or retried. Physical inventory only moves here, deferred from
// checkout — see that route's comment for why.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const db = getDb();
    const saleId = Number(params.id);

    // Everything from here to runTransaction() is synchronous — no `await`
    // between the fulfillment_status check and the write, so a concurrent
    // double-click/retry can't interleave between them (Node's single-
    // threaded event loop guarantees this the same way void/route.ts's own
    // status==='Voided' check already relies on).
    const sale = db.prepare(
      'SELECT id, fulfillment_status, financing_provider, financing_approval_status FROM pos_sales WHERE id = ?'
    ).get(saleId) as { id: number; fulfillment_status: string; financing_provider: string | null; financing_approval_status: string | null } | undefined;
    if (!sale) return NextResponse.json({ error: 'Sale not found' }, { status: 404 });
    if (sale.fulfillment_status !== 'FOR_PICKUP') {
      return NextResponse.json({ error: 'This sale has already been released.' }, { status: 409 });
    }
    if (sale.financing_provider && sale.financing_approval_status !== 'Approved') {
      return NextResponse.json({ error: 'Cannot release item. Financing is not yet approved.' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const lineInputs = new Map<number, ReleaseLine>(
      (Array.isArray(body?.items) ? body.items as ReleaseLine[] : [])
        .filter(l => l?.sale_item_id)
        .map(l => [Number(l.sale_item_id), l])
    );

    const saleItems = db.prepare(
      'SELECT id, product_id, quantity FROM pos_sale_items WHERE sale_id = ? AND product_id IS NOT NULL'
    ).all(saleId) as { id: number; product_id: number; quantity: number }[];

    const getRefundedQty = db.prepare(
      `SELECT COALESCE(SUM(ri.quantity),0) as q FROM pos_refund_items ri
       JOIN pos_refunds r ON r.id = ri.refund_id WHERE ri.sale_item_id = ?`
    );
    const getStock = db.prepare('SELECT COALESCE(quantity,0) as q FROM inventory WHERE product_id = ?');
    const getProductName = db.prepare('SELECT name FROM products WHERE id = ?');

    // Per line: remaining = ordered - already refunded (a partial refund
    // taken before release must not deduct stock for units the customer no
    // longer owns).
    const toRelease: { sale_item_id: number; product_id: number; qty: number }[] = [];
    for (const item of saleItems) {
      const alreadyRefunded = (getRefundedQty.get(item.id) as { q: number }).q;
      const remaining = item.quantity - alreadyRefunded;
      if (remaining <= 0) continue;
      toRelease.push({ sale_item_id: item.id, product_id: item.product_id, qty: remaining });
    }

    // Stock is validated per PRODUCT, not per line — a sale can carry two
    // separate lines for the same product (e.g. one freebie + one paid,
    // since PosClient.tsx never merges a freebie line into a paid one for
    // the same product), and checking each line's need against the same
    // undecremented stock snapshot independently would let both "pass" even
    // when their combined need exceeds what's actually available.
    // All-or-nothing: if any product falls short, nothing releases.
    const neededByProduct = new Map<number, number>();
    for (const r of toRelease) neededByProduct.set(r.product_id, (neededByProduct.get(r.product_id) ?? 0) + r.qty);
    for (const [productId, needed] of neededByProduct) {
      const stock = (getStock.get(productId) as { q: number } | undefined)?.q ?? 0;
      if (stock < needed) {
        const name = (getProductName.get(productId) as { name: string } | undefined)?.name ?? `product #${productId}`;
        return NextResponse.json({ error: `Cannot release item. No available stock for "${name}".` }, { status: 400 });
      }
    }

    const insertMovement = db.prepare(`
      INSERT INTO stock_movements (product_id, type, quantity, note, moved_at) VALUES (?, 'OUT', ?, ?, datetime('now'))
    `);
    // Same upsert shape as checkout's adjustInventory — the raw delta bound
    // separately for the conflict branch so MAX(0,...) only ever floors the
    // stored result, never pre-floors the input (see route.ts's comment on
    // why that distinction matters).
    const adjustInventory = db.prepare(`
      INSERT INTO inventory (product_id, quantity, last_updated)
      VALUES (?, MAX(0, ?), datetime('now'))
      ON CONFLICT(product_id) DO UPDATE SET
        quantity = MAX(0, quantity + ?),
        last_updated = datetime('now')
    `);
    const updateSaleItem = db.prepare(
      'UPDATE pos_sale_items SET serial_number=?, imei_1=?, imei_2=? WHERE id=?'
    );
    const updateSale = db.prepare(
      `UPDATE pos_sales SET fulfillment_status='RELEASED', released_by=?, released_at=datetime('now') WHERE id=?`
    );

    runTransaction(() => {
      for (const r of toRelease) {
        insertMovement.run(r.product_id, r.qty, `POS Sale #${saleId} (Pickup Release)`);
        adjustInventory.run(r.product_id, -r.qty, -r.qty);
        const input = lineInputs.get(r.sale_item_id);
        if (input && (input.serial_number || input.imei_1 || input.imei_2)) {
          updateSaleItem.run(
            input.serial_number?.trim() || null, input.imei_1?.trim() || null, input.imei_2?.trim() || null,
            r.sale_item_id,
          );
        }
      }
      updateSale.run(session.id, saleId);
      logSaleAudit(db, saleId, session.id, 'ITEM_RELEASED', `${toRelease.length} line(s)`);
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
