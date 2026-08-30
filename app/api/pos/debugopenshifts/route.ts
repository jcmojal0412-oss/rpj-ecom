import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

// TEMPORARY diagnostic — remove after the online-payment-breakdown
// investigation is done. Lists every open shift's sales with the raw
// payment_method/online_amount fields, so we can see why
// computeShiftOnlineByMethod comes back empty for a shift whose
// online_sales total is clearly nonzero.
export async function GET() {
  try {
    const db = getDb();
    const shifts = db.prepare(`
      SELECT s.id, u.name as cashier_name, s.time_in
      FROM pos_shifts s LEFT JOIN users u ON u.id = s.cashier_id
      WHERE s.status = 'Open' ORDER BY s.time_in DESC LIMIT 5
    `).all() as { id: number; cashier_name: string | null; time_in: string }[];

    const result = shifts.map(sh => {
      const sales = db.prepare(`
        SELECT id, receipt_no, payment_method, cash_amount, online_amount, change_due, status
        FROM pos_sales WHERE shift_id = ? ORDER BY created_at
      `).all(sh.id);
      const paymentRows = db.prepare(`
        SELECT sale_id, method, amount, reference_no FROM pos_sale_payments WHERE sale_id IN (SELECT id FROM pos_sales WHERE shift_id = ?)
      `).all(sh.id);
      return { shift: sh, sales, paymentRows };
    });

    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
