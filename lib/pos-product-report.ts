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

  // Service/fee lines (Labor Fee, Reservation Fee) have product_id = NULL —
  // exclude them so this product-focused report isn't polluted by non-inventory charges.
  const clauses: string[] = [`s.status != 'Voided'`, `i.product_id IS NOT NULL`];
  const params: (string | number)[] = [];
  if (from) { clauses.push('s.sale_date >= ?'); params.push(from); }
  if (to) { clauses.push('s.sale_date <= ?'); params.push(to); }
  if (businessId) { clauses.push('s.business_id = ?'); params.push(Number(businessId)); }
  if (productId) { clauses.push('i.product_id = ?'); params.push(Number(productId)); }
  if (category) { clauses.push('p.category = ?'); params.push(category); }
  if (cashierId) { clauses.push('s.cashier_id = ?'); params.push(Number(cashierId)); }

  // Net out refunds/exchanges per line, not just raw original sale amounts —
  // otherwise a fully-returned item still shows as full revenue here forever,
  // which is exactly why this report used to drift from Gross/Net Sales
  // elsewhere. Quantity and revenue always shrink by whatever was refunded
  // (the customer doesn't have the item anymore, full stop); cost only
  // shrinks for the portion that was actually restocked (condition !=
  // 'Defective') — a Defective return means the unit was scrapped, so that
  // cost is genuinely gone, not recovered. Discount is left untouched: it
  // was a real deduction at the moment of the original sale, unaffected by
  // what happens to the item afterward. Not date-filtered on the refund
  // side on purpose — this answers "what did we net sell", not "what
  // happened to net cash this exact period", so a return processed later
  // still nets against the sale it belongs to.
  const sql = `
    WITH refund_agg AS (
      SELECT ri.sale_item_id,
             SUM(ri.quantity) as refunded_qty,
             SUM(ri.line_total) as refunded_value,
             SUM(CASE WHEN ri.condition = 'Defective' THEN 0 ELSE ri.quantity END) as restocked_qty
      FROM pos_refund_items ri
      GROUP BY ri.sale_item_id
    )
    SELECT i.product_id, i.product_name, i.sku, p.category,
           SUM(i.quantity - COALESCE(ra.refunded_qty,0)) as qty_sold,
           SUM(i.quantity * COALESCE(i.cogs,0) - COALESCE(ra.restocked_qty,0) * COALESCE(i.cogs,0)) as total_cost,
           SUM(i.line_total - COALESCE(ra.refunded_value,0)) as total_sales,
           SUM(i.line_total * 1.0 / NULLIF(s.subtotal,0) * s.discount) as total_discount
    FROM pos_sale_items i
    JOIN pos_sales s ON s.id = i.sale_id
    LEFT JOIN products p ON p.id = i.product_id
    LEFT JOIN refund_agg ra ON ra.sale_item_id = i.id
    WHERE ${clauses.join(' AND ')}
    GROUP BY i.product_id, i.product_name, i.sku, p.category
    ORDER BY qty_sold DESC
  `;
  return { sql, params };
}

// Lightweight companion to buildDetailQuery — just SUM(subtotal), the same
// scope Gross Sales already uses (date + business, no product/category/
// cashier narrowing). Computed alongside the detail query in one request so
// the Gross Sales bridge line doesn't cost a whole second round-trip (which
// also duplicated the same pos_sale_items scan the detail query already does).
export function buildGrossSalesQuery(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const businessId = searchParams.get('business_id');

  const clauses: string[] = [`status != 'Voided'`];
  const params: (string | number)[] = [];
  if (from) { clauses.push('sale_date >= ?'); params.push(from); }
  if (to) { clauses.push('sale_date <= ?'); params.push(to); }
  if (businessId) { clauses.push('business_id = ?'); params.push(Number(businessId)); }

  const sql = `SELECT COALESCE(SUM(subtotal),0) as grossSales FROM pos_sales WHERE ${clauses.join(' AND ')}`;
  return { sql, params };
}

export interface DailyDetailRow {
  date: string; product_id: number; product_name: string; sku: string | null; category: string | null; qty_sold: number;
}

// Same filters/refund-netting idea as buildDetailQuery, but grouped by day
// too — answers "how many units per day", which the totals-only detail
// query can't (it collapses the whole date range into one row per product).
// Cost/revenue aren't needed for this view, so the query stays lighter.
export function buildDailyDetailQuery(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const businessId = searchParams.get('business_id');
  const productId = searchParams.get('product_id');
  const category = searchParams.get('category');
  const cashierId = searchParams.get('cashier_id');

  const clauses: string[] = [`s.status != 'Voided'`, `i.product_id IS NOT NULL`];
  const params: (string | number)[] = [];
  if (from) { clauses.push('s.sale_date >= ?'); params.push(from); }
  if (to) { clauses.push('s.sale_date <= ?'); params.push(to); }
  if (businessId) { clauses.push('s.business_id = ?'); params.push(Number(businessId)); }
  if (productId) { clauses.push('i.product_id = ?'); params.push(Number(productId)); }
  if (category) { clauses.push('p.category = ?'); params.push(category); }
  if (cashierId) { clauses.push('s.cashier_id = ?'); params.push(Number(cashierId)); }

  const sql = `
    WITH refund_agg AS (
      SELECT ri.sale_item_id, SUM(ri.quantity) as refunded_qty
      FROM pos_refund_items ri
      GROUP BY ri.sale_item_id
    )
    SELECT s.sale_date as date, i.product_id, i.product_name, i.sku, p.category,
           SUM(i.quantity - COALESCE(ra.refunded_qty,0)) as qty_sold
    FROM pos_sale_items i
    JOIN pos_sales s ON s.id = i.sale_id
    LEFT JOIN products p ON p.id = i.product_id
    LEFT JOIN refund_agg ra ON ra.sale_item_id = i.id
    WHERE ${clauses.join(' AND ')}
    GROUP BY s.sale_date, i.product_id, i.product_name, i.sku, p.category
    HAVING qty_sold > 0
    ORDER BY s.sale_date DESC, qty_sold DESC
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
