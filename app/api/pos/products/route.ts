import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT p.id, p.sku, p.name, p.category, p.srp,
             COALESCE(i.quantity, 0) as quantity
      FROM products p
      LEFT JOIN inventory i ON i.product_id = p.id
      ORDER BY p.name
    `).all();
    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
