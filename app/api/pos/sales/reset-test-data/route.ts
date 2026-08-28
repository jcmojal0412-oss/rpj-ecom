import { NextRequest, NextResponse } from 'next/server';
import { getDb, runTransaction } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// "Test data" = every pos_sales row created while building/testing this POS
// this cycle — reliably identified as external_ref IS NULL, since that
// column is set ONLY by the historical-sales import (the one thing in this
// table that must never be touched). Everything else currently in pos_sales
// predates real cashier use, since that's the whole point of this cleanup:
// clearing the slate before cashiers start.
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    if (session.role !== 'owner') return NextResponse.json({ error: 'Only the owner can reset test data' }, { status: 403 });

    const { mode } = await req.json();
    const db = getDb();

    const testSaleIds = (db.prepare(`SELECT id FROM pos_sales WHERE external_ref IS NULL`).all() as { id: number }[]).map(r => r.id);

    // Defensive check: an exchange sale (linked_sale_id set) whose ORIGINAL
    // sale is a real migrated one would mean a real customer's historical
    // purchase got exchanged during "testing" — that's not test data and
    // this tool must refuse rather than guess.
    const suspect = db.prepare(`
      SELECT s.id FROM pos_sales s
      WHERE s.external_ref IS NULL AND s.linked_sale_id IS NOT NULL
        AND s.linked_sale_id IN (SELECT id FROM pos_sales WHERE external_ref IS NOT NULL)
    `).all() as { id: number }[];

    const saleStats = testSaleIds.length
      ? db.prepare(`
          SELECT COUNT(*) as n, COALESCE(SUM(total),0) as revenue, MIN(sale_date) as from_date, MAX(sale_date) as to_date
          FROM pos_sales WHERE id IN (${testSaleIds.map(() => '?').join(',')})
        `).get(...testSaleIds) as { n: number; revenue: number; from_date: string | null; to_date: string | null }
      : { n: 0, revenue: 0, from_date: null, to_date: null };

    const refundCount = testSaleIds.length
      ? (db.prepare(`SELECT COUNT(*) as n FROM pos_refunds WHERE sale_id IN (${testSaleIds.map(() => '?').join(',')})`).get(...testSaleIds) as { n: number }).n
      : 0;
    const shiftCount = (db.prepare(`SELECT COUNT(*) as n FROM pos_shifts`).get() as { n: number }).n;
    const cashMoveCount = (db.prepare(`SELECT COUNT(*) as n FROM pos_shift_cash_movements`).get() as { n: number }).n;
    const linkedExpenseCount = (db.prepare(`SELECT COUNT(*) as n FROM expenses WHERE shift_id IS NOT NULL`).get() as { n: number }).n;

    const preview = {
      test_sales: saleStats.n,
      test_sales_revenue: saleStats.revenue,
      date_range: saleStats.from_date ? { from: saleStats.from_date, to: saleStats.to_date } : null,
      refunds_to_delete: refundCount,
      shifts_to_delete: shiftCount,
      cash_movements_to_delete: cashMoveCount,
      expenses_to_unlink: linkedExpenseCount,
      suspect_count: suspect.length,
    };

    if (mode === 'preview') {
      return NextResponse.json({ preview: true, ...preview });
    }

    if (suspect.length > 0) {
      return NextResponse.json({
        error: `Refusing to proceed — ${suspect.length} sale(s) marked as test data are actually exchanges against a real migrated sale. This needs a human decision, not an automatic reset.`,
      }, { status: 400 });
    }
    if (testSaleIds.length === 0 && shiftCount === 0) {
      return NextResponse.json({ error: 'Nothing to reset — no test sales or shifts found.' }, { status: 400 });
    }

    runTransaction(() => {
      // 1. Refunds against test sales (cascades to pos_refund_items).
      if (testSaleIds.length) {
        db.prepare(`DELETE FROM pos_refunds WHERE sale_id IN (${testSaleIds.map(() => '?').join(',')})`).run(...testSaleIds);
      }
      // 2. Break the self-referential exchange link within the test set
      //    before deleting, so an original-sale row and its exchange-sale
      //    row don't foreign-key-block each other regardless of delete order.
      if (testSaleIds.length) {
        db.prepare(`UPDATE pos_sales SET linked_sale_id = NULL WHERE external_ref IS NULL`).run();
      }
      // 3. Detach (don't delete) any real expense record that happened to
      //    get linked to a test shift — expenses are a separate, standalone
      //    ledger, not POS test scaffolding.
      db.prepare(`UPDATE expenses SET shift_id = NULL WHERE shift_id IS NOT NULL`).run();
      // 4. Shift-scoped rows, in dependency order.
      db.prepare(`DELETE FROM pos_shift_cash_movements`).run();
      // 5. The test sales themselves (pos_sale_items cascades automatically).
      if (testSaleIds.length) {
        db.prepare(`DELETE FROM pos_sales WHERE external_ref IS NULL`).run();
      }
      // 6. Now safe — nothing still points at a pos_shifts row.
      db.prepare(`DELETE FROM pos_shifts`).run();
      // 7. Next real sale starts the BNS series fresh, exactly as originally intended.
      db.prepare(`UPDATE app_settings SET value = '108' WHERE key = 'pos_receipt_seq_next'`).run();
    });

    return NextResponse.json({ ...preview, done: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
