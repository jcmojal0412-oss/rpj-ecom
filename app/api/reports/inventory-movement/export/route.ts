import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { getDb } from '@/lib/db';
import { todayISO } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const { searchParams } = new URL(req.url);
    const to = searchParams.get('to') || todayISO();
    const from = searchParams.get('from') || to;

    const rows = db.prepare(`
      WITH after_range AS (
        SELECT product_id,
          COALESCE(SUM(CASE WHEN type='IN' THEN quantity ELSE 0 END),0) as in_after,
          COALESCE(SUM(CASE WHEN type='OUT' THEN quantity ELSE 0 END),0) as out_after
        FROM stock_movements WHERE date(moved_at) > ? GROUP BY product_id
      ),
      during_range AS (
        SELECT product_id,
          COALESCE(SUM(CASE WHEN type='IN' THEN quantity ELSE 0 END),0) as in_during,
          COALESCE(SUM(CASE WHEN type='OUT' THEN quantity ELSE 0 END),0) as out_during
        FROM stock_movements WHERE date(moved_at) BETWEEN ? AND ? GROUP BY product_id
      )
      SELECT p.sku, p.name, p.category, p.cogs,
        (COALESCE(i.quantity,0) - COALESCE(ar.in_after,0) + COALESCE(ar.out_after,0)) as ending_qty,
        (COALESCE(i.quantity,0) - COALESCE(ar.in_after,0) + COALESCE(ar.out_after,0))
          - COALESCE(dr.in_during,0) + COALESCE(dr.out_during,0) as beginning_qty,
        COALESCE(dr.in_during,0) as stock_in,
        COALESCE(dr.out_during,0) as stock_out
      FROM products p
      LEFT JOIN inventory i ON i.product_id = p.id
      LEFT JOIN after_range ar ON ar.product_id = p.id
      LEFT JOIN during_range dr ON dr.product_id = p.id
      ORDER BY p.sku
    `).all(to, from, to) as {
      sku: string; name: string; category: string | null; cogs: number;
      ending_qty: number; beginning_qty: number; stock_in: number; stock_out: number;
    }[];

    const headers = ['SKU', 'Product Name', 'Category', 'COGS', 'Beginning Qty', 'Stock In', 'Stock Out', 'Ending Qty', 'Beginning Value', 'Ending Value'];
    const data = rows.map(r => [
      r.sku, r.name, r.category || '', r.cogs, r.beginning_qty, r.stock_in, r.stock_out, r.ending_qty,
      r.beginning_qty * (r.cogs || 0), r.ending_qty * (r.cogs || 0),
    ]);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws['!cols'] = headers.map(() => ({ wch: 16 }));
    XLSX.utils.book_append_sheet(wb, ws, 'Beginning-Ending Inventory');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="beginning-ending-inventory-report.xlsx"',
      },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
