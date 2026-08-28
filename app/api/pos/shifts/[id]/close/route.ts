import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const db = getDb();
    const shift = db.prepare(`
      SELECT s.*, u.name as cashier_name, u.username, b.name as business_name
      FROM pos_shifts s
      LEFT JOIN users u ON u.id = s.cashier_id
      LEFT JOIN businesses b ON b.id = s.business_id
      WHERE s.id = ?
    `).get(params.id) as
      { id: number; cashier_id: number; status: string; starting_cash: number; time_in: string; cashier_name: string | null; business_name: string | null; notes: string | null } | undefined;
    if (!shift) return NextResponse.json({ error: 'Shift not found' }, { status: 404 });
    if (shift.status === 'Closed') return NextResponse.json({ error: 'Shift is already closed' }, { status: 400 });
    if (shift.cashier_id !== session.id) return NextResponse.json({ error: 'This is not your shift' }, { status: 403 });

    const { actual_cash, notes } = await req.json();
    const actualCashNum = actual_cash ? parseFloat(actual_cash) : 0;
    const combinedNotes = [shift.notes, notes?.trim() ? `End: ${notes.trim()}` : null].filter(Boolean).join(' | ') || null;

    const totals = db.prepare(
      `SELECT COUNT(*) as transaction_count, COALESCE(SUM(cash_amount),0) as cash_sales, COALESCE(SUM(online_amount),0) as online_sales, COALESCE(SUM(total),0) as total_sales, COALESCE(SUM(discount),0) as total_discount, COALESCE(SUM(financing_amount),0) as financing_receivable
       FROM pos_sales WHERE shift_id = ? AND status != 'Voided'`
    ).get(shift.id) as { transaction_count: number; cash_sales: number; online_sales: number; total_sales: number; total_discount: number; financing_receivable: number };

    const financingByProvider = db.prepare(
      `SELECT financing_provider as provider, COALESCE(SUM(financing_amount),0) as amount
       FROM pos_sales WHERE shift_id = ? AND status != 'Voided' AND financing_provider IS NOT NULL
       GROUP BY financing_provider ORDER BY financing_provider`
    ).all(shift.id) as { provider: string; amount: number }[];

    const voidTotals = db.prepare(
      `SELECT COUNT(*) as void_count, COALESCE(SUM(total),0) as void_amount FROM pos_sales WHERE shift_id = ? AND status = 'Voided'`
    ).get(shift.id) as { void_count: number; void_amount: number };

    const refundTotals = db.prepare(
      `SELECT COALESCE(SUM(r.total_refund),0) as refund_amount FROM pos_refunds r JOIN pos_sales s ON s.id = r.sale_id WHERE s.shift_id = ?`
    ).get(shift.id) as { refund_amount: number };

    const cashMovements = db.prepare(
      `SELECT COALESCE(SUM(CASE WHEN type='IN' THEN amount ELSE 0 END),0) as cash_in,
              COALESCE(SUM(CASE WHEN type='OUT' THEN amount ELSE 0 END),0) as cash_out
       FROM pos_shift_cash_movements WHERE shift_id = ?`
    ).get(shift.id) as { cash_in: number; cash_out: number };

    const expectedCash = shift.starting_cash + totals.cash_sales + cashMovements.cash_in - cashMovements.cash_out;
    const discrepancy = actualCashNum - expectedCash;
    const timeOut = new Date().toISOString();

    db.prepare(`
      UPDATE pos_shifts SET
        time_out = datetime('now'), status = 'Closed', notes = ?,
        cash_sales = ?, online_sales = ?, financing_receivable = ?, expected_cash = ?, actual_cash = ?, discrepancy = ?
      WHERE id = ?
    `).run(combinedNotes, totals.cash_sales, totals.online_sales, totals.financing_receivable, expectedCash, actualCashNum, discrepancy, shift.id);

    return NextResponse.json({
      ok: true,
      business_name: shift.business_name, cashier_name: shift.cashier_name,
      time_in: shift.time_in, time_out: timeOut, notes: combinedNotes,
      starting_cash: shift.starting_cash, transaction_count: totals.transaction_count,
      cash_sales: totals.cash_sales, online_sales: totals.online_sales, total_sales: totals.total_sales,
      total_discount: totals.total_discount, void_count: voidTotals.void_count, void_amount: voidTotals.void_amount,
      refund_amount: refundTotals.refund_amount,
      cash_in: cashMovements.cash_in, cash_out: cashMovements.cash_out,
      expected_cash: expectedCash, actual_cash: actualCashNum, discrepancy,
      financing_receivable: totals.financing_receivable, financing_by_provider: financingByProvider,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
