import { NextRequest, NextResponse } from 'next/server';
import { getDb, resolveProductCategory } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// GET is intentionally NOT permission-gated — read cross-module (AI FB Ads'
// product picker, same reasoning as /api/businesses in middleware.ts).
// Mutations below require 'products' since middleware.ts doesn't gate this
// path at all (see the comment there).
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
    const session = await getSession();
    if (!session || (session.role !== 'owner' && !session.permissions.includes('products'))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const db = getDb();
    const body = await req.json();
    const { sku, name, barcode, category, cogs, srp, reorder_point } = body;

    if (!sku?.trim() || !name?.trim()) {
      return NextResponse.json({ error: 'SKU and Product Name are required' }, { status: 400 });
    }
    const skuTrim = sku.trim();
    const existingSku = db.prepare('SELECT name FROM products WHERE sku = ?').get(skuTrim) as { name: string } | undefined;
    if (existingSku) {
      return NextResponse.json({ error: `SKU "${skuTrim}" already exists (${existingSku.name}). Please use a different SKU.` }, { status: 409 });
    }
    const cogsNum = Number(cogs) || 0;
    const srpNum = Number(srp) || 0;
    const reorderNum = reorder_point != null ? Number(reorder_point) : 10;
    if (cogsNum < 0 || srpNum < 0 || !Number.isFinite(reorderNum) || reorderNum < 0) {
      return NextResponse.json({ error: 'COGS, SRP, and Reorder Point must be valid, non-negative numbers' }, { status: 400 });
    }
    const barcodeTrim = typeof barcode === 'string' ? barcode.trim() : '';
    if (barcodeTrim) {
      const dupe = db.prepare('SELECT sku, name FROM products WHERE barcode = ?').get(barcodeTrim) as { sku: string; name: string } | undefined;
      if (dupe) {
        return NextResponse.json({ error: `Barcode "${barcodeTrim}" is already used by ${dupe.name} (${dupe.sku}). Barcodes must be unique.` }, { status: 409 });
      }
    }

    const info = db.prepare(
      'INSERT INTO products (sku, name, barcode, category, cogs, srp, reorder_point) VALUES (?,?,?,?,?,?,?)'
    ).run(skuTrim, name.trim(), barcodeTrim || null, resolveProductCategory(db, category), cogsNum, srpNum, reorderNum);

    db.prepare(
      "INSERT INTO inventory (product_id, quantity, last_updated) VALUES (?,0,datetime('now'))"
    ).run(info.lastInsertRowid);

    return NextResponse.json({ id: info.lastInsertRowid }, { status: 201 });
  } catch (e: any) {
    const msg = String(e);
    if (msg.includes('UNIQUE constraint failed: products.sku')) {
      return NextResponse.json({ error: 'SKU already exists. Please use a different SKU.' }, { status: 409 });
    }
    if (msg.includes('idx_products_barcode_unique') || msg.includes('UNIQUE constraint failed: products.barcode')) {
      return NextResponse.json({ error: 'That barcode is already used by another product. Barcodes must be unique.' }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
