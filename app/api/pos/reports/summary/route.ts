import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const { searchParams } = new URL(req.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const businessId = searchParams.get('business_id');

    const saleClauses: string[] = [`status != 'Voided'`];
    const saleParams: (string | number)[] = [];
    if (from) { saleClauses.push('sale_date >= ?'); saleParams.push(from); }
    if (to) { saleClauses.push('sale_date <= ?'); saleParams.push(to); }
    if (businessId) { saleClauses.push('business_id = ?'); saleParams.push(Number(businessId)); }
    const saleWhere = saleClauses.join(' AND ');

    const totals = db.prepare(
      `SELECT COALESCE(SUM(total),0) as totalSales, COUNT(*) as totalOrders FROM pos_sales WHERE ${saleWhere}`
    ).get(...saleParams) as { totalSales: number; totalOrders: number };

    const byDay = db.prepare(
      `SELECT sale_date as date, COALESCE(SUM(total),0) as total, COUNT(*) as orders
       FROM pos_sales WHERE ${saleWhere} GROUP BY sale_date ORDER BY sale_date`
    ).all(...saleParams);

    const refundClauses: string[] = [];
    const refundParams: (string | number)[] = [];
    if (from) { refundClauses.push('r.refund_date >= ?'); refundParams.push(from); }
    if (to) { refundClauses.push('r.refund_date <= ?'); refundParams.push(to); }
    if (businessId) { refundClauses.push('s.business_id = ?'); refundParams.push(Number(businessId)); }
    const refundWhere = refundClauses.length ? `WHERE ${refundClauses.join(' AND ')}` : '';

    const refundTotals = db.prepare(
      `SELECT COALESCE(SUM(r.total_refund),0) as totalRefunds
       FROM pos_refunds r JOIN pos_sales s ON s.id = r.sale_id ${refundWhere}`
    ).get(...refundParams) as { totalRefunds: number };

    return NextResponse.json({
      totalSales: totals.totalSales,
      totalOrders: totals.totalOrders,
      totalRefunds: refundTotals.totalRefunds,
      netSales: totals.totalSales - refundTotals.totalRefunds,
      byDay,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
