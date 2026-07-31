import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

const PROVIDERS = ['SKYRO', 'BILLEASE', 'SALMON', 'HOME CREDIT', 'POS TERMINAL'];

export async function GET(req: NextRequest) {
  const db = getDb();
  const provider = req.nextUrl.searchParams.get('provider');
  const rows = provider && provider !== 'ALL'
    ? db.prepare('SELECT * FROM financing_sales WHERE provider = ? ORDER BY sale_date DESC, id DESC').all(provider)
    : db.prepare('SELECT * FROM financing_sales ORDER BY sale_date DESC, id DESC').all();
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  try {
    const db = getDb();
    const body = await req.json();
    const { provider, amount, sale_date, customer_name, reference_no, notes, screenshot_path } = body;

    if (!provider || !PROVIDERS.includes(provider)) {
      return NextResponse.json({ error: 'Valid provider is required' }, { status: 400 });
    }
    if (amount == null || isNaN(Number(amount))) {
      return NextResponse.json({ error: 'Valid amount is required' }, { status: 400 });
    }

    const info = db.prepare(`
      INSERT INTO financing_sales (provider, amount, sale_date, customer_name, reference_no, notes, screenshot_path)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      provider, Number(amount), sale_date || null, customer_name?.trim() || null,
      reference_no?.trim() || null, notes?.trim() || null, screenshot_path || null
    );

    return NextResponse.json({ id: Number(info.lastInsertRowid) }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
