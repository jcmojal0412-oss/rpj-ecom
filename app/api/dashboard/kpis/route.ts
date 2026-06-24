import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);

    const inventoryValue = (db.prepare(`
      SELECT COALESCE(SUM(i.quantity * p.cogs), 0) as value
      FROM inventory i JOIN products p ON p.id = i.product_id
    `).get() as { value: number }).value;

    const totalSkus = (db.prepare('SELECT COUNT(*) as c FROM products').get() as { c: number }).c;

    const todayIn = (db.prepare(`
      SELECT COALESCE(SUM(quantity), 0) as total FROM stock_movements
      WHERE type='IN' AND date(moved_at)=?
    `).get(today) as { total: number }).total;

    const todayOut = (db.prepare(`
      SELECT COALESCE(SUM(quantity), 0) as total FROM stock_movements
      WHERE type='OUT' AND date(moved_at)=?
    `).get(today) as { total: number }).total;

    return NextResponse.json({ inventoryValue, totalSkus, todayIn, todayOut });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
