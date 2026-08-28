import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { buildPaymentMethodQuery } from '@/lib/pos-payment-method-report';

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

    return NextResponse.json({
      totalSales: summary.total_sales,
      totalCount: summary.total_count,
      byMethod,
      sales,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
