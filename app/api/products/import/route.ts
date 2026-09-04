import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';

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

interface RowPlan {
  rowNum: number; sku: string; name: string; barcode: string | null; category: string | null;
  cogs: number; srp: number; qty: number; reorderPoint: number;
  existingId: number | null; oldQty: number;
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || (session.role !== 'owner' && !session.permissions.includes('products'))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    // Defaults to 'preview' (never writes) rather than 'confirm', so a
    // request that's missing the mode field for any reason can't silently
    // overwrite live stock — the client must explicitly ask to commit.
    const mode = String(formData.get('mode') ?? 'preview');

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
    const findSku = db.prepare('SELECT id FROM products WHERE sku = ?');
    const getInv = db.prepare('SELECT COALESCE(quantity,0) as q FROM inventory WHERE product_id = ?');
    const findBarcode = db.prepare('SELECT id, sku FROM products WHERE barcode = ?');
    // Barcodes must be unique — tracks both against what's already in the DB
    // (excluding the row's own existing product, since re-importing it with
    // its own unchanged barcode isn't a conflict) and against other rows in
    // this same file, so two new products sharing one barcode by mistake
    // don't both sail through as separate inserts.
    const barcodesSeenThisImport = new Map<string, number>(); // barcode -> rowNum
    // Same idea for brand-new SKUs — two rows in the same file introducing
    // the same not-yet-existing SKU would otherwise both plan as "new" (the
    // DB doesn't know about either yet) and only fail at write time, one at
    // a time, with a raw SQLite error instead of a clear skip.
    const newSkusSeenThisImport = new Map<string, number>(); // sku -> rowNum

    // Categories are free text, but casing must stay consistent — otherwise
    // the same category (e.g. "Electronics" vs "ELECTRONICS") splits into
    // separate filter chips everywhere it's grouped (Products page, POS
    // tabs, Inventory Movement Report). Resolve every row's category
    // case-insensitively against what's already in the DB so re-typed
    // casing snaps back to the canonical spelling in use; a brand-new
    // category keeps its as-typed casing and becomes canonical for the
    // rest of this same import.
    const existingCategories = (db.prepare(
      `SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND category != ''`
    ).all() as { category: string }[]).map(r => r.category);
    const categoryCanon = new Map<string, string>();
    for (const c of existingCategories) categoryCanon.set(c.toLowerCase(), c);
    const resolveCategory = (raw: string | null): string | null => {
      if (!raw) return null;
      const key = raw.toLowerCase();
      const canonical = categoryCanon.get(key);
      if (canonical) return canonical;
      categoryCanon.set(key, raw);
      return raw;
    };

    // Read-only pass — computes exactly what would happen for every row,
    // with zero writes. Preview and confirm both run this same pass, then
    // confirm additionally applies it, so the numbers a cashier/owner
    // confirms against are guaranteed to match what actually gets written.
    const plans: RowPlan[] = [];
    const errors: string[] = [];
    let skipped = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // +2 = header is row 1

      const sku = String(row['SKU'] ?? '').trim().toUpperCase();
      const name = String(row['Product Name'] ?? '').trim();

      if (!sku) { errors.push(`Row ${rowNum}: SKU is missing — skipped`); skipped++; continue; }
      if (!name) { errors.push(`Row ${rowNum} (${sku}): Product Name is missing — skipped`); skipped++; continue; }

      const cogs = parseFloat(String(row['COGS'] ?? 0)) || 0;
      const srp = parseFloat(String(row['SRP'] ?? 0)) || 0;
      const qty = parseInt(String(row['QTY'] ?? 0)) || 0;
      const reorderPoint = parseInt(String(row['Reorder Point'] ?? 10)) || 10;
      const category = resolveCategory(String(row['Category'] ?? '').trim() || null);
      const barcode = String(row['BARCODE'] ?? '').trim() || null;

      const existing = findSku.get(sku) as { id: number } | undefined;

      if (!existing) {
        const seenSkuAtRow = newSkusSeenThisImport.get(sku);
        if (seenSkuAtRow) {
          errors.push(`Row ${rowNum} (${sku}): SKU is duplicated with row ${seenSkuAtRow} in this file — skipped`);
          skipped++;
          continue;
        }
        newSkusSeenThisImport.set(sku, rowNum);
      }

      if (barcode) {
        const dbDupe = findBarcode.get(barcode) as { id: number; sku: string } | undefined;
        if (dbDupe && dbDupe.id !== existing?.id) {
          errors.push(`Row ${rowNum} (${sku}): Barcode "${barcode}" is already used by product ${dbDupe.sku} — skipped`);
          skipped++;
          continue;
        }
        const seenAtRow = barcodesSeenThisImport.get(barcode);
        if (seenAtRow) {
          errors.push(`Row ${rowNum} (${sku}): Barcode "${barcode}" is duplicated with row ${seenAtRow} in this file — skipped`);
          skipped++;
          continue;
        }
        barcodesSeenThisImport.set(barcode, rowNum);
      }

      const oldQty = existing ? ((getInv.get(existing.id) as { q: number } | undefined)?.q ?? 0) : 0;
      plans.push({ rowNum, sku, name, barcode, category, cogs, srp, qty, reorderPoint, existingId: existing?.id ?? null, oldQty });
    }

    const newCount = plans.filter(p => p.existingId === null).length;
    const updateCount = plans.filter(p => p.existingId !== null).length;
    // The risky case a plain "New/Updated" count can't show: an existing
    // product's stock about to go DOWN, possibly because the row's QTY was
    // left blank/wrong rather than a genuine stock correction — this is a
    // straight SET, not additive, so this is the one thing worth a human's
    // eyes before it's applied.
    const decreases = plans
      .filter(p => p.existingId !== null && p.qty < p.oldQty)
      .map(p => ({ sku: p.sku, name: p.name, old_qty: p.oldQty, new_qty: p.qty }));

    if (mode === 'preview') {
      return NextResponse.json({
        preview: true,
        total: rows.length,
        new_count: newCount,
        update_count: updateCount,
        skipped,
        errors,
        decrease_count: decreases.length,
        decreases: decreases.slice(0, 50),
      });
    }

    // mode === 'confirm' — apply the plan computed above.
    const insertProd = db.prepare(
      'INSERT INTO products (sku, name, barcode, category, cogs, srp, reorder_point) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    const updateProd = db.prepare(
      'UPDATE products SET name=?, barcode=?, category=?, cogs=?, srp=?, reorder_point=? WHERE id=?'
    );
    const insertInv = db.prepare(
      "INSERT INTO inventory (product_id, quantity, last_updated) VALUES (?, ?, datetime('now'))"
    );
    const setInv = db.prepare(`
      INSERT INTO inventory (product_id, quantity, last_updated) VALUES (?, ?, datetime('now'))
      ON CONFLICT(product_id) DO UPDATE SET quantity = ?, last_updated = datetime('now')
    `);
    const insertMovement = db.prepare(
      "INSERT INTO stock_movements (product_id, type, quantity, note, moved_at) VALUES (?, ?, ?, ?, datetime('now'))"
    );

    let imported = 0;
    let updated = 0;
    for (const p of plans) {
      try {
        if (p.existingId) {
          updateProd.run(p.name, p.barcode, p.category, p.cogs, p.srp, p.reorderPoint, p.existingId);
          const delta = p.qty - p.oldQty;
          if (delta !== 0) {
            setInv.run(p.existingId, p.qty, p.qty);
            insertMovement.run(p.existingId, delta > 0 ? 'IN' : 'OUT', Math.abs(delta), 'Stock sync (Excel re-import)');
          }
          updated++;
        } else {
          const info = insertProd.run(p.sku, p.name, p.barcode, p.category, p.cogs, p.srp, p.reorderPoint);
          const productId = Number(info.lastInsertRowid);
          insertInv.run(productId, p.qty);
          if (p.qty > 0) insertMovement.run(productId, 'IN', p.qty, 'Initial stock (Excel import)');
          imported++;
        }
      } catch (e) {
        errors.push(`Row ${p.rowNum} (${p.sku}): ${String(e)}`);
        skipped++;
      }
    }

    return NextResponse.json({ total: rows.length, imported, updated, skipped, errors });
  } catch (e) {
    return NextResponse.json({ error: `Failed to parse file: ${String(e)}` }, { status: 500 });
  }
}
