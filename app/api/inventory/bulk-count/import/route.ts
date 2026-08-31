import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { getDb, runTransaction } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

interface CountRow {
  SKU?: unknown;
  'Product Name'?: unknown;
  'Counted Qty'?: unknown;
}

interface RowPlan {
  rowNum: number; sku: string; productId: number; name: string; oldQty: number; newQty: number;
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || (session.role !== 'owner' && !session.permissions.includes('inventory'))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    // Same safe-by-default convention as /api/products/import — a request
    // missing the mode field can never silently write.
    const mode = String(formData.get('mode') ?? 'preview');
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

    const validTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ];
    if (!validTypes.includes(file.type) && !file.name.match(/\.(xlsx|xls)$/i)) {
      return NextResponse.json({ error: 'Please upload an Excel file (.xlsx or .xls)' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = wb.SheetNames.find(n => n === 'Stock Count') ?? wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<CountRow>(ws, { defval: '' });

    if (rows.length === 0) {
      return NextResponse.json({ error: 'The Stock Count sheet is empty.' }, { status: 400 });
    }

    const db = getDb();
    const findSku = db.prepare(`
      SELECT p.id, p.name, COALESCE(i.quantity, 0) as quantity
      FROM products p LEFT JOIN inventory i ON i.product_id = p.id
      WHERE p.sku = ?
    `);

    const plans: RowPlan[] = [];
    const errors: string[] = [];
    let blankSkipped = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // +2 = header is row 1
      const sku = String(row['SKU'] ?? '').trim().toUpperCase();
      const countedRaw = String(row['Counted Qty'] ?? '').trim();

      if (!sku) continue; // fully blank row (e.g. trailing rows) — not an error, just nothing here
      if (countedRaw === '') { blankSkipped++; continue; } // not counted yet — intentionally skipped, not zeroed

      const counted = parseInt(countedRaw, 10);
      if (!Number.isFinite(counted) || counted < 0) {
        errors.push(`Row ${rowNum} (${sku}): Counted Qty must be a non-negative whole number — skipped`);
        continue;
      }

      const product = findSku.get(sku) as { id: number; name: string; quantity: number } | undefined;
      if (!product) {
        errors.push(`Row ${rowNum}: SKU "${sku}" not found — skipped`);
        continue;
      }

      if (counted === product.quantity) continue; // no actual change, nothing to plan
      plans.push({ rowNum, sku, productId: product.id, name: product.name, oldQty: product.quantity, newQty: counted });
    }

    if (mode === 'preview') {
      return NextResponse.json({
        preview: true,
        total_rows: rows.length,
        change_count: plans.length,
        blank_skipped: blankSkipped,
        errors,
        changes: plans.slice(0, 200).map(p => ({ sku: p.sku, name: p.name, old_qty: p.oldQty, new_qty: p.newQty })),
        changes_truncated: plans.length > 200,
      });
    }

    // mode === 'confirm' — apply exactly the plan just previewed.
    let updated = 0;
    runTransaction(() => {
      const setInv = db.prepare(`
        INSERT INTO inventory (product_id, quantity, last_updated) VALUES (?, ?, datetime('now'))
        ON CONFLICT(product_id) DO UPDATE SET quantity = ?, last_updated = datetime('now')
      `);
      const insertMovement = db.prepare(
        "INSERT INTO stock_movements (product_id, type, quantity, note, moved_at) VALUES (?, ?, ?, 'Physical count reconciliation (bulk import)', datetime('now'))"
      );
      for (const p of plans) {
        setInv.run(p.productId, p.newQty, p.newQty);
        const delta = p.newQty - p.oldQty;
        insertMovement.run(p.productId, delta > 0 ? 'IN' : 'OUT', Math.abs(delta));
        updated++;
      }
    });

    return NextResponse.json({ total_rows: rows.length, updated, blank_skipped: blankSkipped, errors });
  } catch (e) {
    return NextResponse.json({ error: `Failed to parse file: ${String(e)}` }, { status: 500 });
  }
}
