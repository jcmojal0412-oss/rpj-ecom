import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { getDb } from '@/lib/db';
import { buildDiscountQuery } from '@/lib/pos-discount-report';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const { where, params } = buildDiscountQuery(req);

    const sales = db.prepare(`
      SELECT s.id, s.created_at, s.subtotal, s.discount, s.total, u.name as cashier_name, b.name as business_name
      FROM pos_sales s
      LEFT JOIN users u ON u.id = s.cashier_id
      LEFT JOIN businesses b ON b.id = s.business_id
      WHERE ${where}
      ORDER BY s.created_at DESC
    `).all(...params) as {
      id: number; created_at: string; subtotal: number; discount: number; total: number;
      cashier_name: string | null; business_name: string | null;
    }[];

    const headers = ['Sale #', 'Date', 'Business', 'Cashier', 'Subtotal', 'Discount', 'Total'];
    const data = sales.map(s => [
      `#${String(s.id).padStart(6, '0')}`, s.created_at, s.business_name || '', s.cashier_name || '',
      s.subtotal, s.discount, s.total,
    ]);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws['!cols'] = headers.map(() => ({ wch: 18 }));
    XLSX.utils.book_append_sheet(wb, ws, 'POS Discount Report');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="pos-discount-report.xlsx"',
      },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
