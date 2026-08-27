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

    // Revenue + COGS from POS sales (excludes Voided — a voided sale never happened).
    const saleClauses: string[] = [`s.status != 'Voided'`];
    const saleParams: (string | number)[] = [];
    if (from) { saleClauses.push('s.sale_date >= ?'); saleParams.push(from); }
    if (to) { saleClauses.push('s.sale_date <= ?'); saleParams.push(to); }
    if (businessId) { saleClauses.push('s.business_id = ?'); saleParams.push(Number(businessId)); }
    const saleWhere = saleClauses.join(' AND ');

    const revenueRow = db.prepare(
      `SELECT COALESCE(SUM(total),0) as revenue FROM pos_sales s WHERE ${saleWhere}`
    ).get(...saleParams) as { revenue: number };

    const cogsRow = db.prepare(`
      SELECT COALESCE(SUM(i.quantity * i.cogs),0) as cogs
      FROM pos_sale_items i JOIN pos_sales s ON s.id = i.sale_id
      WHERE ${saleWhere}
    `).get(...saleParams) as { cogs: number };

    // Refunds — own date field (refund_date), joined to pos_sales only for business scoping.
    const refundClauses: string[] = [];
    const refundParams: (string | number)[] = [];
    if (from) { refundClauses.push('r.refund_date >= ?'); refundParams.push(from); }
    if (to) { refundClauses.push('r.refund_date <= ?'); refundParams.push(to); }
    if (businessId) { refundClauses.push('s.business_id = ?'); refundParams.push(Number(businessId)); }
    const refundWhere = refundClauses.length ? `WHERE ${refundClauses.join(' AND ')}` : '';
    const refundRow = db.prepare(
      `SELECT COALESCE(SUM(r.total_refund),0) as refunds FROM pos_refunds r JOIN pos_sales s ON s.id = r.sale_id ${refundWhere}`
    ).get(...refundParams) as { refunds: number };

    // Operating expenses, same filtering pattern as app/api/expenses/route.ts.
    const expClauses: string[] = ['e.deleted_at IS NULL'];
    const expParams: (string | number)[] = [];
    if (from) { expClauses.push('e.date >= ?'); expParams.push(from); }
    if (to) { expClauses.push('e.date <= ?'); expParams.push(to); }
    if (businessId) { expClauses.push('e.business_id = ?'); expParams.push(Number(businessId)); }
    const expWhere = expClauses.join(' AND ');

    const expensesByCategory = db.prepare(
      `SELECT category, COALESCE(SUM(amount),0) as amount FROM expenses e WHERE ${expWhere} GROUP BY category ORDER BY amount DESC`
    ).all(...expParams) as { category: string; amount: number }[];
    const totalExpenses = expensesByCategory.reduce((s, r) => s + r.amount, 0);

    const revenue = revenueRow.revenue;
    const refunds = refundRow.refunds;
    const netRevenue = revenue - refunds;
    const cogs = cogsRow.cogs;
    const grossProfit = netRevenue - cogs;
    const grossMarginPct = netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0;
    const netProfit = grossProfit - totalExpenses;
    const netMarginPct = netRevenue > 0 ? (netProfit / netRevenue) * 100 : 0;

    return NextResponse.json({
      revenue, refunds, netRevenue, cogs, grossProfit, grossMarginPct,
      expensesByCategory, totalExpenses, netProfit, netMarginPct,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
