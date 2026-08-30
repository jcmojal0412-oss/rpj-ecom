import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { buildFreebieWhere } from '@/lib/pos-freebie-report';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const { where, params } = buildFreebieWhere(req);

    const summary = db.prepare(`
      SELECT COUNT(*) as freebie_count, COALESCE(SUM(i.original_price * i.quantity),0) as total_value
      FROM pos_sale_items i JOIN pos_sales s ON s.id = i.sale_id
      WHERE ${where}
    `).get(...params) as { freebie_count: number; total_value: number };

    const byCashier = db.prepare(`
      SELECT s.cashier_id, u.name as cashier_name, COUNT(*) as count,
             COALESCE(SUM(i.original_price * i.quantity),0) as total_value
      FROM pos_sale_items i JOIN pos_sales s ON s.id = i.sale_id
      LEFT JOIN users u ON u.id = s.cashier_id
      WHERE ${where}
      GROUP BY s.cashier_id ORDER BY total_value DESC
    `).all(...params);

    const items = db.prepare(`
      SELECT i.id as item_id, s.id as sale_id, s.receipt_no, s.created_at,
             b.name as business_name, u.name as cashier_name,
             i.product_name, i.sku, i.quantity, i.original_price,
             (i.original_price * i.quantity) as value, i.freebie_reason
      FROM pos_sale_items i JOIN pos_sales s ON s.id = i.sale_id
      LEFT JOIN businesses b ON b.id = s.business_id
      LEFT JOIN users u ON u.id = s.cashier_id
      WHERE ${where}
      ORDER BY s.created_at DESC
    `).all(...params);

    return NextResponse.json({
      totalValue: summary.total_value,
      freebieCount: summary.freebie_count,
      avgValue: summary.freebie_count > 0 ? summary.total_value / summary.freebie_count : 0,
      byCashier,
      items,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
