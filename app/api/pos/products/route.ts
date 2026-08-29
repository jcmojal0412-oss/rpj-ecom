import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    // POS grid order: manually pinned items (pos_featured, set on the
    // Products page) first, then everything else alphabetical.
    const rows = db.prepare(`
      SELECT p.id, p.sku, p.name, p.category, p.srp, p.pos_featured,
             COALESCE(i.quantity, 0) as quantity
      FROM products p
      LEFT JOIN inventory i ON i.product_id = p.id
      ORDER BY p.pos_featured DESC, p.name
    `).all();
    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
