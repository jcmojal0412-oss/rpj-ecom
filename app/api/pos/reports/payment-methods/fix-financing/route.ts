import { NextRequest, NextResponse } from 'next/server';
import { getDb, runTransaction } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { buildPaymentMethodQuery } from '@/lib/pos-payment-method-report';

export const dynamic = 'force-dynamic';

// One-time correction for sales written before the payment_method fix in
// app/api/pos/sales/route.ts — a Cash-downpayment + Financing sale used to
// save payment_method reflecting only the cash/online leg (e.g. "Cash"),
// silently dropping the financing portion from the Payment Method Report's
// grouping. This finds every sale, within the SAME filters the report
// itself is showing, where financing_provider is set but the label doesn't
// already say so, and appends "<Provider> Financing" to whatever label is
// already there — exactly the same construction the live checkout route
// now does for new sales, just applied retroactively. Owner-only: this
// rewrites real transaction records, even though only a descriptive label,
// never an amount.
function findMismatched(req: NextRequest) {
  const db = getDb();
  const { where, params } = buildPaymentMethodQuery(req);
  const rows = db.prepare(`
    SELECT id, sale_date, payment_method, financing_provider
    FROM pos_sales s
    WHERE ${where} AND financing_provider IS NOT NULL
  `).all(...params) as { id: number; sale_date: string; payment_method: string | null; financing_provider: string }[];

  return rows
    .map(r => {
      const financingLabel = `${r.financing_provider} Financing`;
      const alreadyCorrect = !!r.payment_method && r.payment_method.includes(financingLabel);
      const newLabel = alreadyCorrect ? r.payment_method! : [r.payment_method, financingLabel].filter(Boolean).join(' + ');
      return { id: r.id, sale_date: r.sale_date, oldLabel: r.payment_method, newLabel, alreadyCorrect };
    })
    .filter(r => !r.alreadyCorrect);
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== 'owner') return NextResponse.json({ error: 'Owner only' }, { status: 403 });
  return NextResponse.json({ mismatched: findMismatched(req) });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== 'owner') return NextResponse.json({ error: 'Owner only' }, { status: 403 });

  const mismatched = findMismatched(req);
  if (mismatched.length === 0) return NextResponse.json({ updated: 0, sales: [] });

  const db = getDb();
  const update = db.prepare('UPDATE pos_sales SET payment_method = ? WHERE id = ?');
  runTransaction(() => {
    for (const row of mismatched) update.run(row.newLabel, row.id);
  });

  return NextResponse.json({ updated: mismatched.length, sales: mismatched });
}
