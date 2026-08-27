import { NextRequest } from 'next/server';

export interface DetailRow {
  product_id: number; product_name: string; sku: string | null; category: string | null;
  qty_sold: number; total_cost: number; total_sales: number; total_discount: number;
}

export function buildDetailQuery(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const businessId = searchParams.get('business_id');
  const productId = searchParams.get('product_id');
  const category = searchParams.get('category');
  const cashierId = searchParams.get('cashier_id');

  const clauses: string[] = [`s.status != 'Voided'`];
  const params: (string | number)[] = [];
  if (from) { clauses.push('s.sale_date >= ?'); params.push(from); }
  if (to) { clauses.push('s.sale_date <= ?'); params.push(to); }
  if (businessId) { clauses.push('s.business_id = ?'); params.push(Number(businessId)); }
  if (productId) { clauses.push('i.product_id = ?'); params.push(Number(productId)); }
  if (category) { clauses.push('p.category = ?'); params.push(category); }
  if (cashierId) { clauses.push('s.cashier_id = ?'); params.push(Number(cashierId)); }

  const sql = `
    SELECT i.product_id, i.product_name, i.sku, p.category,
           SUM(i.quantity) as qty_sold,
           SUM(i.quantity * COALESCE(i.cogs,0)) as total_cost,
           SUM(i.line_total) as total_sales,
           SUM(i.line_total * 1.0 / NULLIF(s.subtotal,0) * s.discount) as total_discount
    FROM pos_sale_items i
    JOIN pos_sales s ON s.id = i.sale_id
    LEFT JOIN products p ON p.id = i.product_id
    WHERE ${clauses.join(' AND ')}
    GROUP BY i.product_id, i.product_name, i.sku, p.category
    ORDER BY qty_sold DESC
  `;
  return { sql, params };
}

export function computeRows(raw: DetailRow[]) {
  return raw.map(r => {
    const totalDiscount = r.total_discount || 0;
    const unitCost = r.qty_sold > 0 ? r.total_cost / r.qty_sold : 0;
    const unitPrice = r.qty_sold > 0 ? r.total_sales / r.qty_sold : 0;
    const profit = r.total_sales - r.total_cost - totalDiscount;
    return { ...r, total_discount: totalDiscount, unit_cost: unitCost, unit_price: unitPrice, profit };
  });
}
