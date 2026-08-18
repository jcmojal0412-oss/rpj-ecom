import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    const rows = db.prepare(
      'SELECT * FROM service_center_marketing_expenses ORDER BY expense_date DESC, id DESC'
    ).all();
    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
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
      INSERT INTO service_center_marketing_expenses (expense_date, category, amount, description, reference)
      VALUES (?,?,?,?,?)
    `).run(
      expense_date, category.trim(), amountNum,
      description?.trim() || null, reference?.trim() || null,
    );

    return NextResponse.json({ id: info.lastInsertRowid }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
