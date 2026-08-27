import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

export const dynamic = 'force-dynamic';

export async function GET() {
  const wb = XLSX.utils.book_new();

  // ── Instructions sheet ──────────────────────────────────────────────
  const instructions = [
    ['RPJ ECOM SYSTEM — Product Import Template'],
    [''],
    ['HOW TO USE:'],
    ['1. Go to the "Products" sheet (tab below)'],
    ['2. Fill in your product data starting from Row 2'],
    ['3. Delete the sample rows before importing'],
    ['4. SKU and Product Name are REQUIRED fields'],
    ['5. SKU must be UNIQUE — duplicate SKUs will be skipped'],
    ['6. COGS and SRP values should be in Philippine Peso (no ₱ sign needed)'],
    ['7. QTY = starting stock count — this becomes the product\'s initial inventory'],
    ['8. Reorder Point = stock level that triggers a Low Stock alert'],
    ['9. Save this file then upload it in the Products page or the Inventory page'],
    [''],
    ['COLUMN GUIDE:'],
    ['SKU',          'Unique product code (e.g. PROD-001). Will be UPPERCASED automatically.'],
    ['Product Name', 'Full product name (e.g. Wireless Earbuds Pro)'],
    ['BARCODE',      'Optional. Scannable barcode number, if different from SKU.'],
    ['Category',     'Optional. e.g. Electronics, Apparel, Home Goods'],
    ['COGS',         'Cost of Goods Sold per unit in ₱ (e.g. 450)'],
    ['SRP',          'Suggested Retail Price in ₱ (e.g. 999)'],
    ['QTY',          'Starting stock quantity for this product (e.g. 20). Leave 0 if none yet.'],
    ['Reorder Point','Minimum stock before Low Stock alert triggers (e.g. 10)'],
  ];
  const wsInfo = XLSX.utils.aoa_to_sheet(instructions);
  wsInfo['!cols'] = [{ wch: 20 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, wsInfo, 'Instructions');

  // ── Products sheet ───────────────────────────────────────────────────
  const headers = ['SKU', 'Product Name', 'BARCODE', 'Category', 'COGS', 'SRP', 'QTY', 'Reorder Point'];
  const sample = [
    ['PROD-001', 'Sample Product 1', 888000000001, 'Electronics', 500,  1200, 20, 10],
    ['PROD-002', 'Sample Product 2', 888000000002, 'Apparel',     150,   450, 15, 20],
    ['PROD-003', 'Sample Product 3', 888000000003, 'Home Goods',  200,   599, 30, 15],
    ['PROD-004', 'Sample Product 4', 888000000004, 'Electronics', 800,  1999, 10, 10],
    ['PROD-005', 'Sample Product 5', 888000000005, 'Apparel',      90,   299, 25, 25],
  ];

  const ws = XLSX.utils.aoa_to_sheet([headers, ...sample]);
  ws['!cols'] = [
    { wch: 15 }, // SKU
    { wch: 35 }, // Product Name
    { wch: 16 }, // BARCODE
    { wch: 18 }, // Category
    { wch: 10 }, // COGS
    { wch: 10 }, // SRP
    { wch: 10 }, // QTY
    { wch: 14 }, // Reorder Point
  ];

  // Bold the header row
  const headerStyle = { font: { bold: true } };
  ['A1','B1','C1','D1','E1','F1','G1','H1'].forEach(cell => {
    if (ws[cell]) ws[cell].s = headerStyle;
  });

  XLSX.utils.book_append_sheet(wb, ws, 'Products');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="rpj-product-import-template.xlsx"',
    },
  });
}
