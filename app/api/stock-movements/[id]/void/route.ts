import { NextRequest, NextResponse } from 'next/server';
import { getDb, runTransaction } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { IN_REASONS, OUT_REASONS } from '@/components/inventory/constants';

export const dynamic = 'force-dynamic';

// Only a MANUAL Stock In/Out entry (single or bulk, via app/api/stock-movements
// and app/api/stock-movements/bulk) is voidable here — those are exactly the
// ones a staff mis-click/typo can produce, and they're the only ones whose
// note always starts with one of these Reason strings. A POS sale's own OUT
// movement, a refund's IN, a Purchase Order receipt, or a Bulk Stock Count
// reconciliation each already has its own correction path (Void Sale, a new
// Refund, editing the PO, re-uploading the count) that also updates ITS OWN
// records — voiding just the stock_movements row here would silently
// desync a sale/PO/count from the inventory number without touching the
// record that actually explains it.
const MANUAL_REASONS = [...IN_REASONS, ...OUT_REASONS];
function isManualNote(note: string | null): boolean {
  if (!note) return false;
  return MANUAL_REASONS.some(r => note === r || note.startsWith(`${r}: `));
}

export async function POST(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== 'owner') {
    return NextResponse.json({ error: 'Owner only' }, { status: 403 });
  }

  const db = getDb();
  const movement = db.prepare(`
    SELECT sm.id, sm.product_id, sm.type, sm.quantity, sm.note, sm.voided_at, p.name as product_name
    FROM stock_movements sm JOIN products p ON p.id = sm.product_id
    WHERE sm.id = ?
  `).get(params.id) as { id: number; product_id: number; type: 'IN' | 'OUT'; quantity: number; note: string | null; voided_at: string | null; product_name: string } | undefined;

  if (!movement) return NextResponse.json({ error: 'Movement not found' }, { status: 404 });
  if (movement.voided_at) return NextResponse.json({ error: 'This entry is already voided.' }, { status: 409 });
  if (!isManualNote(movement.note)) {
    return NextResponse.json({
      error: 'Only manual Stock In/Stock Out entries can be voided here. This one came from a sale, refund, purchase order, or bulk count — use that record\'s own correction instead.',
    }, { status: 400 });
  }

  // Reversing an OUT that outran what's currently on hand (e.g. more was
  // sold since the mistaken OUT was logged) would push quantity negative —
  // same "no negative inventory" rule as every other stock-reducing path.
  // A voided IN is floored at 0 the same way a plain Stock Out already is.
  const invRow = db.prepare('SELECT quantity FROM inventory WHERE product_id = ?').get(movement.product_id) as { quantity: number } | undefined;
  const currentStock = invRow?.quantity ?? 0;
  const reversalDelta = movement.type === 'IN' ? -movement.quantity : movement.quantity;
  const newStock = Math.max(0, currentStock + reversalDelta);

  runTransaction(() => {
    db.prepare('UPDATE stock_movements SET voided_at = datetime(\'now\'), voided_by = ? WHERE id = ?').run(session!.id, movement.id);
    db.prepare(`
      INSERT INTO inventory (product_id, quantity, last_updated) VALUES (?, ?, datetime('now'))
      ON CONFLICT(product_id) DO UPDATE SET quantity = ?, last_updated = datetime('now')
    `).run(movement.product_id, newStock, newStock);
  });

  return NextResponse.json({ ok: true, product_name: movement.product_name, previous_stock: currentStock, new_stock: newStock });
}
