import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

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

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM marketing_performance WHERE id = ?').get(params.id);
  if (!row) return NextResponse.json({ error: 'Record not found' }, { status: 404 });
  return NextResponse.json(row);
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getDb();
    const body = await req.json();

    const error = validateRecord(body);
    if (error) return NextResponse.json({ error }, { status: 400 });

    const dupe = db.prepare('SELECT id FROM marketing_performance WHERE entry_date = ? AND id != ?').get(body.entry_date, params.id);
    if (dupe) {
      return NextResponse.json({ error: 'Another record already exists for this date.' }, { status: 409 });
    }

    db.prepare(`
      UPDATE marketing_performance SET
        entry_date=?, marketing_spend=?, gross_sales=?, total_buyers=?, new_customers=?, store_visits=?, notes=?,
        updated_at=datetime('now')
      WHERE id=?
    `).run(
      body.entry_date,
      Number(body.marketing_spend),
      Number(body.gross_sales),
      Number(body.total_buyers),
      Number(body.new_customers),
      Number(body.store_visits),
      body.notes?.trim() || null,
      params.id,
    );

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getDb();
    db.prepare('DELETE FROM marketing_performance WHERE id=?').run(params.id);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
