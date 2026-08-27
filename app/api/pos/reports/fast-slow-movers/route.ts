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

    const saleClauses: string[] = [`s.status != 'Voided'`];
    const saleParams: (string | number)[] = [];
    if (from) { saleClauses.push('s.sale_date >= ?'); saleParams.push(from); }
    if (to) { saleClauses.push('s.sale_date <= ?'); saleParams.push(to); }
    if (businessId) { saleClauses.push('s.business_id = ?'); saleParams.push(Number(businessId)); }
    const saleWhere = saleClauses.join(' AND ');

    const fast = db.prepare(`
      SELECT i.product_id, i.product_name, i.sku, SUM(i.quantity) as qty_sold
      FROM pos_sale_items i
      JOIN pos_sales s ON s.id = i.sale_id
      WHERE ${saleWhere}
      GROUP BY i.product_id, i.product_name, i.sku
      ORDER BY qty_sold DESC
      LIMIT 5
    `).all(...saleParams);

    // LEFT JOIN from products (not pos_sale_items) so items with zero sales
    // in this range show up too — that's what makes this a genuine
    // slow/dead-stock list rather than just "least of the ones that sold."
    const soldSubClauses: string[] = [`s.status != 'Voided'`];
    const soldParams: (string | number)[] = [];
    if (from) { soldSubClauses.push('s.sale_date >= ?'); soldParams.push(from); }
    if (to) { soldSubClauses.push('s.sale_date <= ?'); soldParams.push(to); }
    if (businessId) { soldSubClauses.push('s.business_id = ?'); soldParams.push(Number(businessId)); }

    const slow = db.prepare(`
      SELECT p.id as product_id, p.name as product_name, p.sku,
             COALESCE((
               SELECT SUM(i.quantity) FROM pos_sale_items i
               JOIN pos_sales s ON s.id = i.sale_id
               WHERE i.product_id = p.id AND ${soldSubClauses.join(' AND ')}
             ), 0) as qty_sold
      FROM products p
      ORDER BY qty_sold ASC, p.name ASC
      LIMIT 5
    `).all(...soldParams);

    return NextResponse.json({ fast, slow });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
