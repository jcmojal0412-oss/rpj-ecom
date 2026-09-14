import { NextResponse } from 'next/server';
import { getDb, runTransaction } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// One-time correction for exchange sales recorded before the fix in
// app/api/pos/sales/[id]/exchange/route.ts — total was stored as the
// replacement item's full sticker price (subtotal) instead of what the
// customer actually still owed after the returned item's value was
// credited (subtotal - exchange_credit_applied), double-counting the
// credited amount in every report that sums sale totals. The correct
// value is derivable from columns already on the row — no need to touch
// stock, cash_amount, or the linked refund, all of which were always
// correct.
function findAffected(db: ReturnType<typeof getDb>) {
  const rows = db.prepare(`
    SELECT id, receipt_no, sale_date, subtotal, exchange_credit_applied, total
    FROM pos_sales
    WHERE linked_sale_id IS NOT NULL AND exchange_credit_applied > 0
      AND total != (subtotal - exchange_credit_applied)
    ORDER BY sale_date DESC
  `).all() as { id: number; receipt_no: string | null; sale_date: string; subtotal: number; exchange_credit_applied: number; total: number }[];

  return rows.map(r => ({ ...r, correct_total: r.subtotal - r.exchange_credit_applied }));
}

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== 'owner') return NextResponse.json({ error: 'Owner only' }, { status: 403 });

  const db = getDb();
  return NextResponse.json({ affected: findAffected(db) });
}

export async function POST() {
  const session = await getSession();
  if (!session || session.role !== 'owner') return NextResponse.json({ error: 'Owner only' }, { status: 403 });

  const db = getDb();
  const affected = findAffected(db);
  if (affected.length === 0) return NextResponse.json({ corrected: 0, sales: [] });

  const update = db.prepare('UPDATE pos_sales SET total = ? WHERE id = ?');
  runTransaction(() => {
    for (const row of affected) update.run(row.correct_total, row.id);
  });

  return NextResponse.json({ corrected: affected.length, sales: affected });
}
