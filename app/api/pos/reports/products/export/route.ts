import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { getDb } from '@/lib/db';
import { buildDetailQuery, computeRows, type DetailRow } from '@/lib/pos-product-report';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const { sql, params } = buildDetailQuery(req);
    const raw = db.prepare(sql).all(...params) as DetailRow[];
    const rows = computeRows(raw);

    const headers = ['Product', 'Category', 'Qty Sold', 'Unit Cost', 'Total Cost of Goods', 'Selling Price', 'Total Sales', 'Total Discount', 'Profit'];
    const data = rows.map(r => [
      r.product_name, r.category || '', r.qty_sold, r.unit_cost, r.total_cost,
      r.unit_price, r.total_sales, r.total_discount, r.profit,
    ]);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws['!cols'] = headers.map(() => ({ wch: 18 }));
    XLSX.utils.book_append_sheet(wb, ws, 'Product Sales Report');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="product-sales-report.xlsx"',
      },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
