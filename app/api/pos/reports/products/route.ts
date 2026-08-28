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

    const clauses: string[] = [`s.status != 'Voided'`, `i.product_id IS NOT NULL`];
    const params: (string | number)[] = [];
    if (from) { clauses.push('s.sale_date >= ?'); params.push(from); }
    if (to) { clauses.push('s.sale_date <= ?'); params.push(to); }
    if (businessId) { clauses.push('s.business_id = ?'); params.push(Number(businessId)); }

    const rows = db.prepare(`
      SELECT i.product_id, i.product_name, i.sku,
             SUM(i.quantity) as qty_sold, COALESCE(SUM(i.line_total),0) as revenue
      FROM pos_sale_items i
      JOIN pos_sales s ON s.id = i.sale_id
      WHERE ${clauses.join(' AND ')}
      GROUP BY i.product_id, i.product_name, i.sku
      ORDER BY qty_sold DESC
    `).all(...params);

    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
