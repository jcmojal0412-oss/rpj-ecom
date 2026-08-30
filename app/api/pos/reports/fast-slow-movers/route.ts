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

    const saleClauses: string[] = [`s.status != 'Voided'`, `i.product_id IS NOT NULL`];
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
      LIMIT 20
    `).all(...saleParams);

    // LEFT JOIN from products (not pos_sale_items) so items with zero sales
    // in this range show up too — that's what makes this a genuine
    // slow/dead-stock list rather than just "least of the ones that sold."
    // A product with stock <= 0 has nothing left to move, so it's excluded —
    // showing it as "slow moving" would be actionable-nonsense (there's no
    // inventory to push). Rewritten from a per-row correlated subquery (one
    // pos_sale_items/pos_sales scan per product — O(products × sale_items),
    // the dominant cost of the old 15-20s dashboard load with ~1,100
    // products) to a single-pass LEFT JOIN + GROUP BY.
    const soldSubClauses: string[] = [`s.status != 'Voided'`];
    const soldParams: (string | number)[] = [];
    if (from) { soldSubClauses.push('s.sale_date >= ?'); soldParams.push(from); }
    if (to) { soldSubClauses.push('s.sale_date <= ?'); soldParams.push(to); }
    if (businessId) { soldSubClauses.push('s.business_id = ?'); soldParams.push(Number(businessId)); }
    const soldMatch = soldSubClauses.join(' AND ');

    // Among equally slow items, the one tying up the most stock floats to
    // the top — that's the real priority order for what to push or promote.
    const slow = db.prepare(`
      SELECT p.id as product_id, p.name as product_name, p.sku, COALESCE(inv.quantity, 0) as quantity,
             COALESCE(SUM(CASE WHEN ${soldMatch} THEN i.quantity ELSE 0 END), 0) as qty_sold
      FROM products p
      LEFT JOIN inventory inv ON inv.product_id = p.id
      LEFT JOIN pos_sale_items i ON i.product_id = p.id
      LEFT JOIN pos_sales s ON s.id = i.sale_id
      WHERE COALESCE(inv.quantity, 0) > 0
      GROUP BY p.id, p.name, p.sku, inv.quantity
      ORDER BY qty_sold ASC, quantity DESC
      LIMIT 20
    `).all(...soldParams);

    return NextResponse.json({ fast, slow });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
