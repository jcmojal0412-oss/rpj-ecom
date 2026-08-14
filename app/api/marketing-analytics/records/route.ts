import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

function validateRecord(body: any) {
  const { entry_date, marketing_spend, gross_sales, total_buyers, new_customers, store_visits } = body;

  if (!entry_date || typeof entry_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(entry_date)) {
    return 'A valid date is required.';
  }
  const spend = Number(marketing_spend);
  const sales = Number(gross_sales);
  const buyers = Number(total_buyers);
  const newCust = Number(new_customers);
  const visits = Number(store_visits);

  if (isNaN(spend) || spend < 0) return 'Marketing spend must be a valid, non-negative amount.';
  if (isNaN(sales) || sales < 0) return 'Gross sales must be a valid, non-negative amount.';
  if (!Number.isInteger(buyers) || buyers < 0) return 'Total buyers must be a non-negative whole number.';
  if (!Number.isInteger(newCust) || newCust < 0) return 'New customers must be a non-negative whole number.';
  if (!Number.isInteger(visits) || visits < 0) return 'Store visits must be a non-negative whole number.';
  if (newCust > buyers) return 'New customers cannot exceed total buyers.';

  return null;
}

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
