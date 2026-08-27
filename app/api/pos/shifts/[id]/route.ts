import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getDb();
    const shift = db.prepare(`
      SELECT s.*, u.name as cashier_name, u.username, b.name as business_name
      FROM pos_shifts s
      LEFT JOIN users u ON u.id = s.cashier_id
      LEFT JOIN businesses b ON b.id = s.business_id
      WHERE s.id = ?
    `).get(params.id);
    if (!shift) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const sales = db.prepare(`
      SELECT id, sale_date, total, cash_amount, online_amount, status, created_at
      FROM pos_sales WHERE shift_id = ? ORDER BY created_at
    `).all(params.id);

    return NextResponse.json({ shift, sales });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
