import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { buildPaymentMethodQuery } from '@/lib/pos-payment-method-report';
import { CASH_APPLIED_SQL, computeOnlineByMethodInRange } from '@/lib/pos-shift-totals';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const { where, params } = buildPaymentMethodQuery(req);

    const summary = db.prepare(`
      SELECT COUNT(*) as total_count, COALESCE(SUM(s.total),0) as total_sales
      FROM pos_sales s WHERE ${where}
    `).get(...params) as { total_count: number; total_sales: number };

    // payment_method is a free-text label ("Cash", "GCash", "Cash + GCash",
    // "Skyro Financing", "Downpayment", "Cashback + Cash", etc.) set at
    // checkout time — grouping directly on it is what actually shows the
    // cashier which specific method each sale came through, not just the
    // coarse cash-vs-online split used elsewhere in reporting.
    const byMethod = db.prepare(`
      SELECT COALESCE(NULLIF(s.payment_method,''), 'Unspecified') as payment_method,
             COUNT(*) as count, COALESCE(SUM(s.total),0) as total
      FROM pos_sales s WHERE ${where}
      GROUP BY payment_method
      ORDER BY total DESC
    `).all(...params);

    const sales = db.prepare(`
      SELECT s.id, s.created_at, s.payment_method, s.total, s.cash_amount, s.online_amount,
             s.financing_amount, s.cashback_amount, u.name as cashier_name, b.name as business_name
      FROM pos_sales s
      LEFT JOIN users u ON u.id = s.cashier_id
      LEFT JOIN businesses b ON b.id = s.business_id
      WHERE ${where}
      ORDER BY s.created_at DESC
    `).all(...params);

    // "By Payment Method" above groups by the exact label used at checkout
    // ("Cash + Salmon Financing" shows its full sale value on one row) — a
    // fair, honest view of which combinations happened, but not directly
    // comparable to the Cashier's Report's Payment Breakdown, which instead
    // decomposes every sale into its raw legs (so a combo sale's cash
    // portion counts toward Cash, its financing portion toward Financing,
    // separately). Both are correct; they answer different questions. This
    // second summary exists so the two reports can be read side by side
    // without doing that mental math — reuses the exact same
    // CASH_APPLIED_SQL / computeOnlineByMethodInRange / financing_amount
    // logic the shift-level report already uses, just scoped to this
    // report's own date/business/cashier filter instead of one shift.
    const legTotals = db.prepare(`
      SELECT COALESCE(SUM(${CASH_APPLIED_SQL}),0) as cash_applied,
             COALESCE(SUM(s.financing_amount),0) as financing_applied
      FROM pos_sales s WHERE ${where}
    `).get(...params) as { cash_applied: number; financing_applied: number };
    const onlineByMethod = computeOnlineByMethodInRange(db, where, params);

    return NextResponse.json({
      totalSales: summary.total_sales,
      totalCount: summary.total_count,
      byMethod,
      sales,
      byLeg: { cash: legTotals.cash_applied, online: onlineByMethod, financing: legTotals.financing_applied },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
