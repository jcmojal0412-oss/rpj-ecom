import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getDb();
    const {
      business_id, category, date, amount, paid_to, payment_method,
      reference_no, notes, receipt_path, status,
    } = await req.json();

    if (!business_id) return NextResponse.json({ error: 'Business is required' }, { status: 400 });
    if (!category) return NextResponse.json({ error: 'Category is required' }, { status: 400 });
    if (!date) return NextResponse.json({ error: 'Expense date is required' }, { status: 400 });
    if (!paid_to || !paid_to.trim()) return NextResponse.json({ error: 'Paid To is required' }, { status: 400 });
    const amountNum = parseFloat(amount);
    if (!amountNum || amountNum <= 0) return NextResponse.json({ error: 'A positive amount is required' }, { status: 400 });

    const info = db.prepare(`
      UPDATE expenses SET
        date=?, amount=?, description=?, category=?, reference_no=?, paid_to=?, payment_method=?,
        business_id=?, receipt_path=?, status=COALESCE(?, status)
      WHERE id=? AND deleted_at IS NULL
    `).run(
      date, amountNum, notes?.trim() || null, category,
      reference_no?.trim() || null, paid_to.trim(), payment_method?.trim() || null,
      business_id, receipt_path?.trim() || null, status ?? null,
      params.id,
    );

    if (info.changes === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getDb();
    const info = db.prepare(`UPDATE expenses SET deleted_at = datetime('now') WHERE id=? AND deleted_at IS NULL`).run(params.id);
    if (info.changes === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
