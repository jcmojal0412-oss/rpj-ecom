import { NextRequest, NextResponse } from 'next/server';
import { getDb, runTransaction } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { logSaleAudit } from '@/lib/pos-audit';

export const dynamic = 'force-dynamic';

// Owner-only: once financing_approval_status is 'Approved', the release
// endpoint trusts it completely and lets inventory walk out the door — this
// is the actual trust boundary for a FOR PICKUP financed sale, so it gets
// the same bar as Void (the other owner-only, comparable-severity POS
// action) rather than being open to any cashier who could otherwise both
// self-approve and release in one visit.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    if (session.role !== 'owner') return NextResponse.json({ error: 'Only the owner can update financing status' }, { status: 403 });

    const db = getDb();
    const saleId = Number(params.id);
    const { approval_status, remittance_status } = await req.json();

    const sale = db.prepare(
      'SELECT id, financing_provider FROM pos_sales WHERE id = ?'
    ).get(saleId) as { id: number; financing_provider: string | null } | undefined;
    if (!sale) return NextResponse.json({ error: 'Sale not found' }, { status: 404 });
    if (!sale.financing_provider) return NextResponse.json({ error: 'This sale is not financed' }, { status: 400 });

    if (approval_status !== undefined) {
      if (!['Approved', 'Declined', 'Pending'].includes(approval_status)) {
        return NextResponse.json({ error: 'Invalid financing approval status' }, { status: 400 });
      }
      runTransaction(() => {
        db.prepare('UPDATE pos_sales SET financing_approval_status=? WHERE id=?').run(approval_status, saleId);
        logSaleAudit(db, saleId, session.id, 'FINANCING_APPROVAL_CHANGED', approval_status);
      });
    } else if (remittance_status !== undefined) {
      // Remittance is a separate concern from approval — a customer can be
      // approved long before the provider actually pays the store. Never
      // touches quantity or inventory.
      if (!['Pending', 'Received'].includes(remittance_status)) {
        return NextResponse.json({ error: 'Invalid remittance status' }, { status: 400 });
      }
      runTransaction(() => {
        db.prepare('UPDATE pos_sales SET financing_remittance_status=? WHERE id=?').run(remittance_status, saleId);
        logSaleAudit(db, saleId, session.id, 'FINANCING_REMITTANCE_CHANGED', remittance_status);
      });
    } else {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
