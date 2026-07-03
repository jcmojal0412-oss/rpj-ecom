import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM products ORDER BY sku').all();
    return NextResponse.json(rows);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = getDb();
    const body = await req.json();
    const { sku, name, category, cogs, srp, reorder_point } = body;

    const info = db.prepare(
      'INSERT INTO products (sku, name, category, cogs, srp, reorder_point) VALUES (?,?,?,?,?,?)'
    ).run(sku, name, category, cogs, srp, reorder_point ?? 10);

    db.prepare(
      'INSERT INTO inventory (product_id, quantity, last_updated) VALUES (?,0,datetime("now"))'
    ).run(info.lastInsertRowid);

    return NextResponse.json({ id: info.lastInsertRowid }, { status: 201 });
  } catch (e: any) {
    const msg = String(e);
    if (msg.includes('UNIQUE constraint failed: products.sku')) {
      return NextResponse.json({ error: 'SKU already exists. Please use a different SKU.' }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
