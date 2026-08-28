import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { getDb } from '@/lib/db';
import { computeShiftSalesTotals, computeShiftCashMovements, computeExpectedCash } from '@/lib/pos-shift-totals';

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
      id: number; created_at: string; cashier_name: string | null; username: string | null;
      time_in: string; time_out: string | null; cash_sales: number | null; online_sales: number | null;
      financing_receivable: number | null; starting_cash: number; expected_cash: number | null;
      actual_cash: number | null; discrepancy: number | null; status: string;
    }[];

    // Same live-vs-frozen split as the on-screen report: an open shift's
    // figures are computed live from its completed sales; a closed shift
    // keeps its persisted (frozen-at-close) reconciliation values.
    const data = rows.map(r => {
      const totals = computeShiftSalesTotals(db, r.id);
      let cashSales = r.cash_sales ?? 0, onlineSales = r.online_sales ?? 0, financing = r.financing_receivable ?? 0, expectedCash = r.expected_cash;
      if (r.status === 'Open') {
        const movements = computeShiftCashMovements(db, r.id);
        cashSales = totals.cash_sales; onlineSales = totals.online_sales; financing = totals.financing_receivable;
        expectedCash = computeExpectedCash(r.starting_cash, cashSales, movements.cash_in, movements.cash_out);
      }
      const overShort = r.actual_cash != null && expectedCash != null ? r.actual_cash - expectedCash : null;
      return [
        r.created_at, r.cashier_name || '', r.username || '', r.time_in, r.time_out || '',
        cashSales, onlineSales, financing, totals.total_sales, r.starting_cash,
        expectedCash ?? '', r.actual_cash ?? '', overShort ?? '', r.status,
      ];
    });

    const headers = ['Date Created', 'Cashier', 'Username', 'Time-In', 'Time-Out', 'Cash Sales', 'Online / Card', 'Financing', 'Total Sales', 'Starting Cash', 'Expected Cash', 'Actual Cash', 'Over / Short', 'Status'];

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
