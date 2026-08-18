import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Records one customer payment against a repair (supports partial payments —
// the repair's collected total is always the sum of these rows, never a
// single overwritten field).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getDb();
    const { amount, payment_date, payment_method, reference_notes } = await req.json();

    const amountNum = parseFloat(amount);
    if (!amountNum || amountNum <= 0) {
      return NextResponse.json({ error: 'A positive payment amount is required' }, { status: 400 });
    }
    if (!payment_date) {
      return NextResponse.json({ error: 'payment_date is required' }, { status: 400 });
    }

    const repair = db.prepare('SELECT cs_payment FROM service_repairs WHERE id = ?').get(params.id) as { cs_payment: number } | undefined;
    if (!repair) return NextResponse.json({ error: 'Repair not found' }, { status: 404 });

    // Enforced server-side too, not just by the modal's disabled Save button
    // — a payment can never push collected past the repair amount.
    const collected = (db.prepare(
      'SELECT COALESCE(SUM(amount), 0) as c FROM service_repair_payments WHERE repair_id = ?'
    ).get(params.id) as { c: number }).c;
    const remaining = repair.cs_payment - collected;
    if (amountNum > remaining + 0.005) {
      return NextResponse.json({ error: `Payment exceeds the remaining balance of ${remaining.toFixed(2)}` }, { status: 400 });
    }

    const info = db.prepare(`
      INSERT INTO service_repair_payments (repair_id, amount, payment_date, payment_method, reference_notes)
      VALUES (?,?,?,?,?)
    `).run(params.id, amountNum, payment_date, payment_method?.trim() || null, reference_notes?.trim() || null);

    return NextResponse.json({ id: info.lastInsertRowid }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
