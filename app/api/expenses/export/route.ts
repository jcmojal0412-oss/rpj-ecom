import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

const LIST_SQL_BASE = `
  SELECT e.*, b.name as business_name
  FROM expenses e
  LEFT JOIN businesses b ON b.id = e.business_id
  WHERE e.deleted_at IS NULL
`;

export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const { searchParams } = new URL(req.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const businessId = searchParams.get('business_id');
    const category = searchParams.get('category');
    const status = searchParams.get('status');
    const search = searchParams.get('search');

    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (from) { clauses.push('e.date >= ?'); params.push(from); }
    if (to) { clauses.push('e.date <= ?'); params.push(to); }
    if (businessId) { clauses.push('e.business_id = ?'); params.push(Number(businessId)); }
    if (category) { clauses.push('e.category = ?'); params.push(category); }
    if (status) { clauses.push('e.status = ?'); params.push(status); }
    if (search) {
      clauses.push('(e.paid_to LIKE ? OR e.reference_no LIKE ? OR e.description LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like);
    }

    const sql = LIST_SQL_BASE + clauses.map(c => ` AND ${c}`).join('') + ' ORDER BY e.date DESC, e.id DESC';
    const rows = db.prepare(sql).all(...params) as {
      date: string; business_name: string | null; category: string; paid_to: string | null;
      payment_method: string | null; reference_no: string | null; amount: number;
      description: string | null; status: string;
    }[];

    const headers = ['Date', 'Business', 'Category', 'Paid To', 'Payment Method', 'Reference', 'Amount', 'Notes', 'Status'];
    const data = rows.map(r => [
      r.date, r.business_name || '', r.category, r.paid_to || '', r.payment_method || '',
      r.reference_no || '', r.amount, r.description || '', r.status,
    ]);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws['!cols'] = headers.map(() => ({ wch: 18 }));
    XLSX.utils.book_append_sheet(wb, ws, 'Expenses');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="expenses-export.xlsx"`,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
