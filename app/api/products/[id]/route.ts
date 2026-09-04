import { NextRequest, NextResponse } from 'next/server';
import { getDb, resolveProductCategory, runTransaction } from '@/lib/db';
import { getSession } from '@/lib/auth';

async function requireProductsPermission() {
  const session = await getSession();
  if (!session || (session.role !== 'owner' && !session.permissions.includes('products'))) return null;
  return session;
}

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
    if (!await requireProductsPermission()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const db   = getDb();
    const body = await req.json();
    const id   = Number(params.id);

    if ('reorder_point' in body && Object.keys(body).length === 1) {
      const reorderNum = Number(body.reorder_point);
      if (!Number.isFinite(reorderNum) || reorderNum < 0) {
        return NextResponse.json({ error: 'Reorder Point must be a valid, non-negative number' }, { status: 400 });
      }
      db.prepare('UPDATE products SET reorder_point=? WHERE id=?').run(reorderNum, id);
      return NextResponse.json({ ok: true });
    }

    if ('pos_featured' in body && Object.keys(body).length === 1) {
      db.prepare('UPDATE products SET pos_featured=? WHERE id=?').run(body.pos_featured ? 1 : 0, id);
      return NextResponse.json({ ok: true });
    }

    const { name, barcode, category, cogs, srp, reorder_point } = body;
    if (!name?.trim()) return NextResponse.json({ error: 'Product Name is required' }, { status: 400 });
    const cogsNum = Number(cogs) || 0;
    const srpNum = Number(srp) || 0;
    const reorderNum = reorder_point != null ? Number(reorder_point) : 10;
    if (cogsNum < 0 || srpNum < 0 || !Number.isFinite(reorderNum) || reorderNum < 0) {
      return NextResponse.json({ error: 'COGS, SRP, and Reorder Point must be valid, non-negative numbers' }, { status: 400 });
    }
    const barcodeTrim = typeof barcode === 'string' ? barcode.trim() : '';
    if (barcodeTrim) {
      const dupe = db.prepare('SELECT sku, name FROM products WHERE barcode = ? AND id != ?').get(barcodeTrim, id) as { sku: string; name: string } | undefined;
      if (dupe) {
        return NextResponse.json({ error: `Barcode "${barcodeTrim}" is already used by ${dupe.name} (${dupe.sku}). Barcodes must be unique.` }, { status: 409 });
      }
    }
    db.prepare(
      'UPDATE products SET name=?,barcode=?,category=?,cogs=?,srp=?,reorder_point=? WHERE id=?'
    ).run(name.trim(), barcodeTrim || null, resolveProductCategory(db, category), cogsNum, srpNum, reorderNum, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = String(e);
    if (msg.includes('idx_products_barcode_unique') || msg.includes('UNIQUE constraint failed: products.barcode')) {
      return NextResponse.json({ error: 'That barcode is already used by another product. Barcodes must be unique.' }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (!await requireProductsPermission()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const db = getDb();
    const id = Number(params.id);

    // Check product exists
    const exists = db.prepare('SELECT id FROM products WHERE id=?').get(id);
    if (!exists) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

    // Delete child records first to satisfy FK constraints, then the product
    runTransaction(() => {
      db.prepare('DELETE FROM stock_movements WHERE product_id=?').run(id);
      db.prepare('DELETE FROM po_items WHERE product_id=?').run(id);
      db.prepare('DELETE FROM inventory WHERE product_id=?').run(id);
      db.prepare('DELETE FROM products WHERE id=?').run(id);
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
