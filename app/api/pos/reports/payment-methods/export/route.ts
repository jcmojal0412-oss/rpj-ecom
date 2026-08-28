import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { getDb } from '@/lib/db';
import { buildPaymentMethodQuery } from '@/lib/pos-payment-method-report';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const { where, params } = buildPaymentMethodQuery(req);

    const byMethod = db.prepare(`
      SELECT COALESCE(NULLIF(s.payment_method,''), 'Unspecified') as payment_method,
             COUNT(*) as count, COALESCE(SUM(s.total),0) as total
      FROM pos_sales s WHERE ${where}
      GROUP BY payment_method
      ORDER BY total DESC
    `).all(...params) as { payment_method: string; count: number; total: number }[];

    const sales = db.prepare(`
      SELECT s.id, s.created_at, s.payment_method, s.total, u.name as cashier_name, b.name as business_name
      FROM pos_sales s
      LEFT JOIN users u ON u.id = s.cashier_id
      LEFT JOIN businesses b ON b.id = s.business_id
      WHERE ${where}
      ORDER BY s.created_at DESC
    `).all(...params) as {
      id: number; created_at: string; payment_method: string | null; total: number;
      cashier_name: string | null; business_name: string | null;
    }[];

    const wb = XLSX.utils.book_new();

    const methodHeaders = ['Payment Method', 'Transactions', 'Total Amount'];
    const methodData = byMethod.map(m => [m.payment_method, m.count, m.total]);
    const methodWs = XLSX.utils.aoa_to_sheet([methodHeaders, ...methodData]);
    methodWs['!cols'] = methodHeaders.map(() => ({ wch: 20 }));
    XLSX.utils.book_append_sheet(wb, methodWs, 'By Payment Method');

    const saleHeaders = ['Sale #', 'Date', 'Business', 'Cashier', 'Payment Method', 'Total'];
    const saleData = sales.map(s => [
      `#${String(s.id).padStart(6, '0')}`, s.created_at, s.business_name || '', s.cashier_name || '',
      s.payment_method || '', s.total,
    ]);
    const saleWs = XLSX.utils.aoa_to_sheet([saleHeaders, ...saleData]);
    saleWs['!cols'] = saleHeaders.map(() => ({ wch: 18 }));
    XLSX.utils.book_append_sheet(wb, saleWs, 'All Sales');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="pos-payment-method-report.xlsx"',
      },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
