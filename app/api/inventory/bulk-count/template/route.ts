import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Pre-filled with real products (not a blank fill-in-the-blanks template,
// unlike /api/products/template) — the whole point is that the owner never
// has to type a SKU by hand, just fill in what they physically counted.
// Zero/negative-stock products sort first since those are the most
// actionable — the reason this feature exists — but every product is
// included so it also works as a routine full recount later.
export async function GET() {
  const session = await getSession();
  if (!session || (session.role !== 'owner' && !session.permissions.includes('inventory'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getDb();
  const rows = db.prepare(`
    SELECT p.sku, p.name, p.category, COALESCE(i.quantity, 0) as quantity
    FROM products p
    LEFT JOIN inventory i ON i.product_id = p.id
    ORDER BY COALESCE(i.quantity, 0) ASC, p.name ASC
  `).all() as { sku: string; name: string; category: string | null; quantity: number }[];

  const wb = XLSX.utils.book_new();

  const instructions = [
    ['RPJ ECOM SYSTEM — Bulk Stock Count Template'],
    [''],
    ['HOW TO USE:'],
    ['1. Go to the "Stock Count" sheet (tab below)'],
    ['2. Physically count each product and type the real number in "Counted Qty"'],
    ['3. Leave "Counted Qty" BLANK for anything you have not counted yet — blank rows are'],
    ['   skipped entirely, so you can upload this file more than once as you go'],
    ['4. Do NOT edit the SKU column — matching is by SKU, exact as printed here'],
    ['5. Save this file then upload it in the Inventory page — you will see a preview'],
    ['   of exactly what will change before anything is applied'],
    [''],
    ['This sets the EXACT counted quantity (like Edit Stock), it does not add to the'],
    ['current stock (like Stock In does) — enter the full physical count, not a delta.'],
  ];
  const wsInfo = XLSX.utils.aoa_to_sheet(instructions);
  wsInfo['!cols'] = [{ wch: 90 }];
  XLSX.utils.book_append_sheet(wb, wsInfo, 'Instructions');

  const headers = ['SKU', 'Product Name', 'Category', 'Current Stock', 'Counted Qty'];
  const data = rows.map(r => [r.sku, r.name, r.category ?? '', r.quantity, '']);
  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
  ws['!cols'] = [
    { wch: 15 }, // SKU
    { wch: 35 }, // Product Name
    { wch: 18 }, // Category
    { wch: 13 }, // Current Stock
    { wch: 13 }, // Counted Qty
  ];
  const headerStyle = { font: { bold: true } };
  ['A1', 'B1', 'C1', 'D1', 'E1'].forEach(cell => { if (ws[cell]) ws[cell].s = headerStyle; });

  XLSX.utils.book_append_sheet(wb, ws, 'Stock Count');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="rpj-stock-count-template.xlsx"',
    },
  });
}
