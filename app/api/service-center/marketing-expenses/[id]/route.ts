import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getDb();
    const { expense_date, category, amount, description, reference } = await req.json();

    if (!expense_date) {
      return NextResponse.json({ error: 'expense_date is required' }, { status: 400 });
    }
    if (!category || !category.trim()) {
      return NextResponse.json({ error: 'category is required' }, { status: 400 });
    }
    const amountNum = parseFloat(amount);
    if (!amountNum || amountNum <= 0) {
      return NextResponse.json({ error: 'A positive amount is required' }, { status: 400 });
    }

    const info = db.prepare(`
      UPDATE service_center_marketing_expenses SET
        expense_date=?, category=?, amount=?, description=?, reference=?
      WHERE id=?
    `).run(
      expense_date, category.trim(), amountNum,
      description?.trim() || null, reference?.trim() || null,
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
    db.prepare('DELETE FROM service_center_marketing_expenses WHERE id=?').run(params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
