import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM research_statuses ORDER BY sort_order, id').all();
    return NextResponse.json(rows);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = getDb();
    const { name, color } = await req.json();
    if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

    const maxOrder = (db.prepare('SELECT COALESCE(MAX(sort_order),0) as m FROM research_statuses').get() as { m: number }).m;
    const info = db.prepare(
      'INSERT INTO research_statuses (name, color, sort_order) VALUES (?,?,?)'
    ).run(name.trim(), color ?? 'gray', maxOrder + 1);

    return NextResponse.json({ id: Number(info.lastInsertRowid) }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
