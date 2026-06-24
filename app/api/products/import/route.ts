import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface ImportRow {
  SKU?: unknown;
  'Product Name'?: unknown;
  Category?: unknown;
  COGS?: unknown;
  SRP?: unknown;
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
    const checkSku    = db.prepare('SELECT id FROM products WHERE sku = ?');
    const insertProd  = db.prepare(
      'INSERT INTO products (sku, name, category, cogs, srp, reorder_point) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const insertInv   = db.prepare(
      "INSERT INTO inventory (product_id, quantity, last_updated) VALUES (?, 0, datetime('now'))"
    );

    let imported = 0;
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

      // Duplicate check
      if (checkSku.get(sku)) {
        errors.push(`Row ${rowNum}: SKU "${sku}" already exists — skipped`);
        skipped++;
        continue;
      }

      const cogs         = parseFloat(String(row['COGS'] ?? 0))          || 0;
      const srp          = parseFloat(String(row['SRP'] ?? 0))           || 0;
      const reorderPoint = parseInt(String(row['Reorder Point'] ?? 10))  || 10;
      const category     = String(row['Category'] ?? '').trim() || null;

      try {
        const info = insertProd.run(sku, name, category, cogs, srp, reorderPoint);
        insertInv.run(Number(info.lastInsertRowid));
        imported++;
      } catch (e) {
        errors.push(`Row ${rowNum} (${sku}): ${String(e)}`);
        skipped++;
      }
    }

    return NextResponse.json({
      total: rows.length,
      imported,
      skipped,
      errors,
    });
  } catch (e) {
    return NextResponse.json({ error: `Failed to parse file: ${String(e)}` }, { status: 500 });
  }
}
