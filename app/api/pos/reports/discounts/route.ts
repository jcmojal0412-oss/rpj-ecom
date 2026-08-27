import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { buildDiscountQuery } from '@/lib/pos-discount-report';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const { where, params } = buildDiscountQuery(req);

    const summary = db.prepare(`
      SELECT COUNT(*) as discounted_count, COALESCE(SUM(s.discount),0) as total_discount,
             COALESCE(SUM(s.subtotal),0) as total_subtotal
      FROM pos_sales s WHERE ${where}
    `).get(...params) as { discounted_count: number; total_discount: number; total_subtotal: number };

    const byCashier = db.prepare(`
      SELECT s.cashier_id, u.name as cashier_name, COUNT(*) as count, COALESCE(SUM(s.discount),0) as total_discount
      FROM pos_sales s LEFT JOIN users u ON u.id = s.cashier_id
      WHERE ${where}
      GROUP BY s.cashier_id ORDER BY total_discount DESC
    `).all(...params);

    const sales = db.prepare(`
      SELECT s.id, s.created_at, s.subtotal, s.discount, s.total, u.name as cashier_name, b.name as business_name
      FROM pos_sales s
      LEFT JOIN users u ON u.id = s.cashier_id
      LEFT JOIN businesses b ON b.id = s.business_id
      WHERE ${where}
      ORDER BY s.created_at DESC
    `).all(...params);

    return NextResponse.json({
      totalDiscount: summary.total_discount,
      discountedCount: summary.discounted_count,
      avgDiscount: summary.discounted_count > 0 ? summary.total_discount / summary.discounted_count : 0,
      totalSubtotal: summary.total_subtotal,
      byCashier,
      sales,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
