import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface ImportRow {
  SKU?: unknown;
  'Product Name'?: unknown;
  BARCODE?: unknown;
  Category?: unknown;
  COGS?: unknown;
  SRP?: unknown;
  QTY?: unknown;
  'Reorder Point'?: unknown;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const validTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ];
    if (!validTypes.includes(file.type) && !file.name.match(/\.(xlsx|xls)$/i)) {
      return NextResponse.json({ error: 'Please upload an Excel file (.xlsx or .xls)' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buffer, { type: 'buffer' });

    // Use 'Products' sheet if it exists, else the first sheet
    const sheetName = wb.SheetNames.find(n => n === 'Products') ?? wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<ImportRow>(ws, { defval: '' });

    if (rows.length === 0) {
      return NextResponse.json({ error: 'The Products sheet is empty.' }, { status: 400 });
    }

    const db = getDb();
    const findSku     = db.prepare('SELECT id FROM products WHERE sku = ?');
    const insertProd  = db.prepare(
      'INSERT INTO products (sku, name, barcode, category, cogs, srp, reorder_point) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    const updateProd  = db.prepare(
      'UPDATE products SET name=?, barcode=?, category=?, cogs=?, srp=?, reorder_point=? WHERE id=?'
    );
    const insertInv   = db.prepare(
      "INSERT INTO inventory (product_id, quantity, last_updated) VALUES (?, ?, datetime('now'))"
    );
    const getInv      = db.prepare('SELECT COALESCE(quantity,0) as q FROM inventory WHERE product_id = ?');
    const setInv       = db.prepare(`
      INSERT INTO inventory (product_id, quantity, last_updated) VALUES (?, ?, datetime('now'))
      ON CONFLICT(product_id) DO UPDATE SET quantity = ?, last_updated = datetime('now')
    `);
    const insertMovement = db.prepare(
      "INSERT INTO stock_movements (product_id, type, quantity, note, moved_at) VALUES (?, ?, ?, ?, datetime('now'))"
    );

    let imported = 0;
    let updated  = 0;
    let skipped  = 0;
    const errors: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row    = rows[i];
      const rowNum = i + 2; // +2 = header is row 1

      const sku  = String(row['SKU'] ?? '').trim().toUpperCase();
      const name = String(row['Product Name'] ?? '').trim();

      // Validation
      if (!sku) {
        errors.push(`Row ${rowNum}: SKU is missing — skipped`);
        skipped++;
        continue;
      }
      if (!name) {
        errors.push(`Row ${rowNum} (${sku}): Product Name is missing — skipped`);
        skipped++;
        continue;
      }

      const cogs         = parseFloat(String(row['COGS'] ?? 0))          || 0;
      const srp          = parseFloat(String(row['SRP'] ?? 0))           || 0;
      const qty           = parseInt(String(row['QTY'] ?? 0))            || 0;
      const reorderPoint = parseInt(String(row['Reorder Point'] ?? 10))  || 10;
      const category     = String(row['Category'] ?? '').trim() || null;
      const barcode      = String(row['BARCODE'] ?? '').trim() || null;

      try {
        // Existing SKU → update in place (re-uploading a corrected file should
        // refresh price/stock/etc, not get silently skipped) instead of
        // creating a duplicate or leaving stale data behind.
        const existing = findSku.get(sku) as { id: number } | undefined;
        if (existing) {
          updateProd.run(name, barcode, category, cogs, srp, reorderPoint, existing.id);
          const currentQty = (getInv.get(existing.id) as { q: number } | undefined)?.q ?? 0;
          const delta = qty - currentQty;
          if (delta !== 0) {
            setInv.run(existing.id, qty, qty);
            insertMovement.run(existing.id, delta > 0 ? 'IN' : 'OUT', Math.abs(delta), 'Stock sync (Excel re-import)');
          }
          updated++;
        } else {
          const info = insertProd.run(sku, name, barcode, category, cogs, srp, reorderPoint);
          const productId = Number(info.lastInsertRowid);
          insertInv.run(productId, qty);
          if (qty > 0) insertMovement.run(productId, 'IN', qty, 'Initial stock (Excel import)');
          imported++;
        }
      } catch (e) {
        errors.push(`Row ${rowNum} (${sku}): ${String(e)}`);
        skipped++;
      }
    }

    return NextResponse.json({
      total: rows.length,
      imported,
      updated,
      skipped,
      errors,
    });
  } catch (e) {
    return NextResponse.json({ error: `Failed to parse file: ${String(e)}` }, { status: 500 });
  }
}
