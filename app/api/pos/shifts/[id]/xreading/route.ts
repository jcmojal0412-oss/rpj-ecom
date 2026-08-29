import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { computeShiftSalesTotals, computeShiftCashMovements, computeShiftFinancingByProvider, computeShiftCashRefunds, computeExpectedCash, computeShiftOnlineByMethod } from '@/lib/pos-shift-totals';

export const dynamic = 'force-dynamic';

// Non-destructive, mid-shift snapshot — never mutates pos_shifts, can be
// called any number of times while a shift is still Open. Unlike the
// close ("Z Reading") endpoint, nothing here is persisted.
export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getDb();
    const shift = db.prepare(`
      SELECT s.*, u.name as cashier_name, u.username, b.name as business_name
      FROM pos_shifts s
      LEFT JOIN users u ON u.id = s.cashier_id
      LEFT JOIN businesses b ON b.id = s.business_id
      WHERE s.id = ?
    `).get(params.id) as { id: number; starting_cash: number } | undefined;
    if (!shift) return NextResponse.json({ error: 'Shift not found' }, { status: 404 });

    const totals = computeShiftSalesTotals(db, shift.id);
    const financingByProvider = computeShiftFinancingByProvider(db, shift.id);
    const onlineByMethod = computeShiftOnlineByMethod(db, shift.id);

    const voidTotals = db.prepare(
      `SELECT COUNT(*) as void_count, COALESCE(SUM(total),0) as void_amount FROM pos_sales WHERE shift_id = ? AND status = 'Voided'`
    ).get(shift.id) as { void_count: number; void_amount: number };

    const refundTotals = db.prepare(
      `SELECT COALESCE(SUM(r.total_refund),0) as refund_amount FROM pos_refunds r JOIN pos_sales s ON s.id = r.sale_id WHERE s.shift_id = ?`
    ).get(shift.id) as { refund_amount: number };

    const cashMovements = computeShiftCashMovements(db, shift.id);
    const cashRefunds = computeShiftCashRefunds(db, shift.id);

    return NextResponse.json({
      shift,
      transaction_count: totals.transaction_count,
      cash_sales: totals.cash_sales,
      online_sales: totals.online_sales,
      total_sales: totals.total_sales,
      total_discount: totals.total_discount,
      void_count: voidTotals.void_count, void_amount: voidTotals.void_amount,
      refund_amount: refundTotals.refund_amount,
      cash_in: cashMovements.cash_in, cash_out: cashMovements.cash_out, cash_refunds: cashRefunds.cash_refunds,
      expected_cash: computeExpectedCash(shift.starting_cash, totals.cash_sales, cashMovements.cash_in, cashMovements.cash_out, cashRefunds.cash_refunds),
      financing_receivable: totals.financing_receivable, financing_by_provider: financingByProvider,
      online_by_method: onlineByMethod,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
