import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM expenses ORDER BY date DESC, created_at DESC LIMIT 200
  `).all();
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const db = getDb();
  const { date, amount, description, category, reference_no, bank_from, bank_to } = await req.json();
  if (!date || amount == null) {
    return NextResponse.json({ error: 'date and amount are required.' }, { status: 400 });
  }
  const result = db.prepare(`
    INSERT INTO expenses (date, amount, description, category, reference_no, bank_from, bank_to)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(date, amount, description ?? null, category ?? 'Others', reference_no ?? null, bank_from ?? null, bank_to ?? null);
  return NextResponse.json({ id: result.lastInsertRowid });
}

export async function DELETE(req: NextRequest) {
  const db = getDb();
  const { id } = await req.json();
  db.prepare('DELETE FROM expenses WHERE id = ?').run(id);
  return NextResponse.json({ ok: true });
}
