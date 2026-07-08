import { NextRequest, NextResponse } from 'next/server';
import { getDb, runTransaction } from '@/lib/db';
import { todayISO } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    const orders = db.prepare(`
      SELECT po.*,
        (SELECT COUNT(*) FROM po_items WHERE po_id=po.id) as item_count
      FROM purchase_orders po
      ORDER BY po.ordered_at DESC
    `).all();
    return NextResponse.json(orders);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = getDb();
    const { po_number, supplier, notes, ordered_at, status, items,
            total_amount, paid_amount, payment_date, payment_notes } = await req.json();

    const itemList = (items ?? []) as { product_id: number; quantity: number; unit_cost: number }[];
    const total = total_amount ?? itemList.reduce((sum, i) => sum + i.quantity * i.unit_cost, 0);

    let newId: number;

    runTransaction(() => {
      const info = db.prepare(
        `INSERT INTO purchase_orders
          (po_number, supplier, total_amount, status, ordered_at, notes, paid_amount, payment_date, payment_notes)
         VALUES (?,?,?,?,?,?,?,?,?)`
      ).run(
        po_number, supplier, total, status ?? 'pending',
        ordered_at ?? todayISO(),
        notes ?? '',
        paid_amount ?? 0,
        payment_date ?? null,
        payment_notes ?? null,
      );

      newId = Number(info.lastInsertRowid);

      for (const item of itemList) {
        db.prepare(
          'INSERT INTO po_items (po_id, product_id, quantity, unit_cost) VALUES (?,?,?,?)'
        ).run(newId, item.product_id, item.quantity, item.unit_cost);

        if (status === 'received') {
          db.prepare(
            `UPDATE inventory SET quantity=quantity+?, last_updated=datetime('now') WHERE product_id=?`
          ).run(item.quantity, item.product_id);
          db.prepare(
            'INSERT INTO stock_movements (product_id, type, quantity, note, moved_at) VALUES (?,?,?,?,datetime("now"))'
          ).run(item.product_id, 'IN', item.quantity, `PO ${po_number}`);
        }
      }
    });

    return NextResponse.json({ id: newId! }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
