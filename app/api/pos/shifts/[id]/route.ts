import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { CASH_APPLIED_SQL, ONLINE_APPLIED_SQL, computeShiftSalesTotals, computeShiftCashMovements, computeShiftFinancingByProvider, computeShiftCashRefunds, computeExpectedCash, computeShiftOnlineByMethod } from '@/lib/pos-shift-totals';

export const dynamic = 'force-dynamic';

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    // Full cross-cashier shift detail (every sale, cash movement, expense) —
    // reserved for the Cashier's Report (pos_reports/owner), same reasoning
    // as the shift list route.
    const session = await getSession();
    if (!session || (session.role !== 'owner' && !session.permissions.includes('pos_reports'))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const db = getDb();
    const shift = db.prepare(`
      SELECT s.*, u.name as cashier_name, u.username, b.name as business_name
      FROM pos_shifts s
      LEFT JOIN users u ON u.id = s.cashier_id
      LEFT JOIN businesses b ON b.id = s.business_id
      WHERE s.id = ?
    `).get(params.id) as { id: number; status: string; starting_cash: number } | undefined;
    if (!shift) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // cash_applied/online_applied are what actually applied to each sale —
    // never the customer's raw tendered amount (cash_amount/online_amount),
    // which already includes whatever change was handed back.
    const sales = db.prepare(`
      SELECT id, sale_date, total, cash_amount, online_amount, change_due, status, created_at,
             ${CASH_APPLIED_SQL} as cash_applied, ${ONLINE_APPLIED_SQL} as online_applied,
             financing_provider, financing_amount, financing_reference, financing_status
      FROM pos_sales WHERE shift_id = ? ORDER BY created_at
    `).all(params.id);

    const financingByProvider = computeShiftFinancingByProvider(db, shift.id);
    const onlineByMethod = computeShiftOnlineByMethod(db, shift.id);

    const cashMovements = db.prepare(`
      SELECT m.*, u.name as created_by_name
      FROM pos_shift_cash_movements m
      LEFT JOIN users u ON u.id = m.created_by
      WHERE m.shift_id = ? ORDER BY m.created_at
    `).all(params.id);

    const expenses = db.prepare(`
      SELECT e.id, e.date, e.amount, e.category, e.paid_to, e.description, e.created_at
      FROM expenses e WHERE e.shift_id = ? AND e.deleted_at IS NULL ORDER BY e.created_at
    `).all(params.id);

    // Same live-vs-frozen split as the shift list route: an open shift has
    // nothing persisted yet, so its top-summary figures are computed live;
    // a closed shift's reconciliation figures stay exactly as they were at
    // close time, with only total_sales (never a persisted column) refreshed.
    const totals = computeShiftSalesTotals(db, shift.id);
    let liveShift: typeof shift & Record<string, unknown>;
    if (shift.status === 'Open') {
      const movements = computeShiftCashMovements(db, shift.id);
      const cashRefunds = computeShiftCashRefunds(db, shift.id);
      liveShift = {
        ...shift,
        cash_sales: totals.cash_sales,
        online_sales: totals.online_sales,
        financing_receivable: totals.financing_receivable,
        total_sales: totals.total_sales,
        expected_cash: computeExpectedCash(shift.starting_cash, totals.cash_sales, movements.cash_in, movements.cash_out, cashRefunds.cash_refunds),
      };
    } else {
      liveShift = { ...shift, total_sales: totals.total_sales };
    }

    return NextResponse.json({ shift: liveShift, sales, cashMovements, expenses, financingByProvider, onlineByMethod });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
