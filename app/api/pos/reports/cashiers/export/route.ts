import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const { searchParams } = new URL(req.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const businessId = searchParams.get('business_id');
    const username = searchParams.get('username');

    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (from) { clauses.push('s.time_in >= ?'); params.push(from); }
    if (to) { clauses.push('s.time_in <= ?'); params.push(`${to} 23:59:59`); }
    if (businessId) { clauses.push('s.business_id = ?'); params.push(Number(businessId)); }
    if (username) { clauses.push('(u.username LIKE ? OR u.name LIKE ?)'); params.push(`%${username}%`, `%${username}%`); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const rows = db.prepare(`
      SELECT s.*, u.name as cashier_name, u.username, b.name as business_name
      FROM pos_shifts s
      LEFT JOIN users u ON u.id = s.cashier_id
      LEFT JOIN businesses b ON b.id = s.business_id
      ${where}
      ORDER BY s.time_in DESC
    `).all(...params) as {
      created_at: string; cashier_name: string | null; username: string | null;
      time_in: string; time_out: string | null; cash_sales: number | null; online_sales: number | null;
      starting_cash: number; actual_cash: number | null; discrepancy: number | null; status: string;
    }[];

    const headers = ['Date Created', 'Cashier', 'Username', 'Time-In', 'Time-Out', 'Cash Sales', 'Online Sales', 'Starting Cash', 'Actual Cash', 'Discrepancy', 'Status'];
    const data = rows.map(r => [
      r.created_at, r.cashier_name || '', r.username || '', r.time_in, r.time_out || '',
      r.cash_sales ?? 0, r.online_sales ?? 0, r.starting_cash, r.actual_cash ?? '', r.discrepancy ?? '', r.status,
    ]);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws['!cols'] = headers.map(() => ({ wch: 16 }));
    XLSX.utils.book_append_sheet(wb, ws, "Cashier's Report");
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="cashier-shifts-report.xlsx"',
      },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
