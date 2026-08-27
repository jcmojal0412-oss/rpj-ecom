import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const db = getDb();
    const shift = db.prepare('SELECT * FROM pos_shifts WHERE id = ?').get(params.id) as
      { id: number; cashier_id: number; status: string; starting_cash: number } | undefined;
    if (!shift) return NextResponse.json({ error: 'Shift not found' }, { status: 404 });
    if (shift.status === 'Closed') return NextResponse.json({ error: 'Shift is already closed' }, { status: 400 });
    if (shift.cashier_id !== session.id) return NextResponse.json({ error: 'This is not your shift' }, { status: 403 });

    const { actual_cash } = await req.json();
    const actualCashNum = actual_cash ? parseFloat(actual_cash) : 0;

    const totals = db.prepare(
      `SELECT COALESCE(SUM(cash_amount),0) as cash_sales, COALESCE(SUM(online_amount),0) as online_sales
       FROM pos_sales WHERE shift_id = ? AND status != 'Voided'`
    ).get(shift.id) as { cash_sales: number; online_sales: number };

    const expectedCash = shift.starting_cash + totals.cash_sales;
    const discrepancy = actualCashNum - expectedCash;

    db.prepare(`
      UPDATE pos_shifts SET
        time_out = datetime('now'), status = 'Closed',
        cash_sales = ?, online_sales = ?, expected_cash = ?, actual_cash = ?, discrepancy = ?
      WHERE id = ?
    `).run(totals.cash_sales, totals.online_sales, expectedCash, actualCashNum, discrepancy, shift.id);

    return NextResponse.json({
      ok: true, cash_sales: totals.cash_sales, online_sales: totals.online_sales,
      expected_cash: expectedCash, actual_cash: actualCashNum, discrepancy,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
