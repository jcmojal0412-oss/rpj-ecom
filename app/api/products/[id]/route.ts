import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getDb();
    const row = db.prepare('SELECT * FROM products WHERE id=?').get(Number(params.id));
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(row);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db   = getDb();
    const body = await req.json();
    const id   = Number(params.id);

    if ('reorder_point' in body && Object.keys(body).length === 1) {
      db.prepare('UPDATE products SET reorder_point=? WHERE id=?').run(body.reorder_point, id);
      return NextResponse.json({ ok: true });
    }

    const { name, category, cogs, srp, reorder_point } = body;
    db.prepare(
      'UPDATE products SET name=?,category=?,cogs=?,srp=?,reorder_point=? WHERE id=?'
    ).run(name, category, cogs, srp, reorder_point, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getDb();
    const id = Number(params.id);

    // Check product exists
    const exists = db.prepare('SELECT id FROM products WHERE id=?').get(id);
    if (!exists) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

    // Delete child records first to satisfy FK constraints, then the product
    db.prepare('DELETE FROM stock_movements WHERE product_id=?').run(id);
    db.prepare('DELETE FROM po_items WHERE product_id=?').run(id);
    db.prepare('DELETE FROM inventory WHERE product_id=?').run(id);
    db.prepare('DELETE FROM products WHERE id=?').run(id);

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
