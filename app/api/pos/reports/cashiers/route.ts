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

    const clauses: string[] = [`s.status != 'Voided'`];
    const params: (string | number)[] = [];
    if (from) { clauses.push('s.sale_date >= ?'); params.push(from); }
    if (to) { clauses.push('s.sale_date <= ?'); params.push(to); }
    if (businessId) { clauses.push('s.business_id = ?'); params.push(Number(businessId)); }

    const rows = db.prepare(`
      SELECT s.cashier_id, u.name as cashier_name, COUNT(*) as orders, COALESCE(SUM(s.total),0) as total
      FROM pos_sales s
      LEFT JOIN users u ON u.id = s.cashier_id
      WHERE ${clauses.join(' AND ')}
      GROUP BY s.cashier_id
      ORDER BY total DESC
    `).all(...params);

    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
