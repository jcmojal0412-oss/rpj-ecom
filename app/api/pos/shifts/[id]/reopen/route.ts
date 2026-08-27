import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Correcting a closed shift is never done by silently editing its numbers —
// that would break the audit trail. Instead an owner reopens it (clearing
// the close-time fields) so the cashier can End Shift again with the
// corrected actual cash count, going through the same reconciliation path
// as any other shift close.
export async function PUT(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    if (session.role !== 'owner') return NextResponse.json({ error: 'Only the owner can reopen a shift' }, { status: 403 });

    const db = getDb();
    const shift = db.prepare('SELECT id, status FROM pos_shifts WHERE id = ?').get(params.id) as
      { id: number; status: string } | undefined;
    if (!shift) return NextResponse.json({ error: 'Shift not found' }, { status: 404 });
    if (shift.status === 'Open') return NextResponse.json({ error: 'Shift is already open' }, { status: 400 });

    db.prepare(`
      UPDATE pos_shifts SET
        status = 'Open', time_out = NULL,
        cash_sales = NULL, online_sales = NULL, expected_cash = NULL, actual_cash = NULL, discrepancy = NULL
      WHERE id = ?
    `).run(shift.id);

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
