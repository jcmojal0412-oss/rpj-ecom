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

// Best-effort per-method breakdown of "Online Sales" (Card, GCash, Maya,
// Sodexo, Bank Transfer) — the online_amount scalar itself only ever
// tracks the combined non-cash total, never which specific method(s) made
// it up. Two sources, merged:
//  1. pos_sale_payments — the itemized rows a Split-mode sale or a
//     multi-method Financing downpayment actually writes.
//  2. Every other non-cash sale (the common single-tender case, Online/
//     Card mode, which never writes payment-leg rows at all) — bucketed by
//     parsing its payment_method label, using the same change-adjusted
//     "applied" amount as online_sales itself so the sub-lines always sum
//     to the same total shown on the Online Sales line above them.
export function computeShiftOnlineByMethod(db: Database.Database, shiftId: number): { method: string; amount: number }[] {
  const fromLegs = db.prepare(`
    SELECT p.method as method, SUM(p.amount) as amount
    FROM pos_sale_payments p
    JOIN pos_sales s ON s.id = p.sale_id
    WHERE s.shift_id = ? AND s.status != 'Voided' AND p.method != 'Cash'
    GROUP BY p.method
  `).all(shiftId) as { method: string; amount: number }[];

  const fromLabel = db.prepare(`
    SELECT
      CASE
        WHEN payment_method LIKE '%Credit Card%' THEN 'Credit Card'
        WHEN payment_method LIKE '%GCash%' THEN 'GCash'
        WHEN payment_method LIKE '%Maya%' THEN 'Maya'
        WHEN payment_method LIKE '%Sodexo%' THEN 'Sodexo'
        WHEN payment_method LIKE '%Bank Transfer%' THEN 'Bank Transfer'
        ELSE 'Other'
      END as method,
      SUM(${ONLINE_APPLIED_SQL}) as amount
    FROM pos_sales
    WHERE shift_id = ? AND status != 'Voided' AND online_amount > 0
      AND id NOT IN (SELECT DISTINCT sale_id FROM pos_sale_payments)
    GROUP BY method
  `).all(shiftId) as { method: string; amount: number }[];

  const merged = new Map<string, number>();
  for (const row of [...fromLegs, ...fromLabel]) {
    merged.set(row.method, (merged.get(row.method) ?? 0) + row.amount);
  }
  return [...merged.entries()]
    .map(([method, amount]) => ({ method, amount }))
    .filter(r => r.amount > 0)
    .sort((a, b) => b.amount - a.amount);
}

// Only cash_out_amount counts here — the portion of a refund that actually
// left the drawer as physical cash (a plain refund's full value when paid
// back in cash; only the leftover excess for an exchange's returned item,
// since the rest was applied as credit toward the new purchase, never cash
// out of the drawer). Non-cash refunds and the credited portion never
// reduce Expected Cash, same principle as Financing never increasing it.
//
// Attributed by the refund's OWN shift_id — the shift that was open when
// the refund was actually processed — never the original sale's shift.
// A return often happens in a different, later shift than the purchase; a
// return sold in shift #10 but refunded during shift #14 physically empties
// shift #14's drawer, not shift #10's (already closed and frozen by then).
export function computeShiftCashRefunds(db: Database.Database, shiftId: number) {
  return db.prepare(`
    SELECT COALESCE(SUM(cash_out_amount),0) as cash_refunds
    FROM pos_refunds WHERE shift_id = ? AND refund_method = 'Cash'
  `).get(shiftId) as { cash_refunds: number };
}

export const computeExpectedCash = (startingCash: number, cashSales: number, cashIn: number, cashOut: number, cashRefunds: number = 0) =>
  startingCash + cashSales + cashIn - cashOut - cashRefunds;
