import type Database from 'better-sqlite3';

// A customer's tendered amount is not the same as what actually applied to
// the sale — cash_amount/online_amount store what was tendered, change_due
// stores what was handed back. Change always comes out of the drawer as
// physical cash (there's no such thing as electronic change), so the cash
// leg absorbs it first; only if the cash leg can't cover the change does the
// remainder reduce the online leg. This guarantees cash_applied +
// online_applied always equals the sale's Amount Due, in every case —
// including the "stale Cash box left over from Split" scenario.
export const CASH_APPLIED_SQL = `MAX(cash_amount - change_due, 0)`;
export const ONLINE_APPLIED_SQL = `MAX(online_amount - MAX(change_due - cash_amount, 0), 0)`;

export interface ShiftSalesTotals {
  transaction_count: number;
  cash_sales: number;
  online_sales: number;
  financing_receivable: number;
  total_sales: number;
  total_discount: number;
}

// Live-computed from completed (non-voided) sales for a shift — used both
// to show an OPEN shift's running totals (nothing is persisted for it yet)
// and to populate the pos_shifts snapshot at close time. cash_sales/
// online_sales here are AMOUNTS APPLIED, never customer-tendered amounts.
export function computeShiftSalesTotals(db: Database.Database, shiftId: number): ShiftSalesTotals {
  return db.prepare(`
    SELECT COUNT(*) as transaction_count,
           COALESCE(SUM(${CASH_APPLIED_SQL}),0) as cash_sales,
           COALESCE(SUM(${ONLINE_APPLIED_SQL}),0) as online_sales,
           COALESCE(SUM(financing_amount),0) as financing_receivable,
           COALESCE(SUM(total),0) as total_sales,
           COALESCE(SUM(discount),0) as total_discount
    FROM pos_sales WHERE shift_id = ? AND status != 'Voided'
  `).get(shiftId) as ShiftSalesTotals;
}

export function computeShiftCashMovements(db: Database.Database, shiftId: number) {
  return db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN type='IN' THEN amount ELSE 0 END),0) as cash_in,
           COALESCE(SUM(CASE WHEN type='OUT' THEN amount ELSE 0 END),0) as cash_out
    FROM pos_shift_cash_movements WHERE shift_id = ?
  `).get(shiftId) as { cash_in: number; cash_out: number };
}

export function computeShiftFinancingByProvider(db: Database.Database, shiftId: number) {
  return db.prepare(`
    SELECT financing_provider as provider, COALESCE(SUM(financing_amount),0) as amount
    FROM pos_sales WHERE shift_id = ? AND status != 'Voided' AND financing_provider IS NOT NULL
    GROUP BY financing_provider ORDER BY financing_provider
  `).all(shiftId) as { provider: string; amount: number }[];
}

export const computeExpectedCash = (startingCash: number, cashSales: number, cashIn: number, cashOut: number) =>
  startingCash + cashSales + cashIn - cashOut;
