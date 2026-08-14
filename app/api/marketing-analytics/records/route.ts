import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { validateRecord } from '@/lib/marketing-analytics';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const db = getDb();
  const from = req.nextUrl.searchParams.get('from');
  const to = req.nextUrl.searchParams.get('to');

  const rows = from && to
    ? db.prepare('SELECT * FROM marketing_performance WHERE entry_date BETWEEN ? AND ? ORDER BY entry_date DESC').all(from, to)
    : db.prepare('SELECT * FROM marketing_performance ORDER BY entry_date DESC').all();

  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    const db = getDb();
    const body = await req.json();

    const error = validateRecord(body);
    if (error) return NextResponse.json({ error }, { status: 400 });

    const existing = db.prepare('SELECT id FROM marketing_performance WHERE entry_date = ?').get(body.entry_date);
    if (existing) {
      return NextResponse.json({ error: 'A record for this date already exists — edit it instead.' }, { status: 409 });
    }

    const info = db.prepare(`
      INSERT INTO marketing_performance
        (entry_date, marketing_spend, gross_sales, total_buyers, new_customers, store_visits, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      body.entry_date,
      Number(body.marketing_spend),
      Number(body.gross_sales),
      Number(body.total_buyers),
      Number(body.new_customers),
      Number(body.store_visits),
      body.notes?.trim() || null,
      session?.id ?? null,
    );

    return NextResponse.json({ id: Number(info.lastInsertRowid) }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
