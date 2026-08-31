import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

const PROVIDERS = ['SKYRO', 'BILLEASE', 'SALMON', 'HOME CREDIT', 'POS TERMINAL'];

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getDb();
    const body = await req.json();
    const { provider, amount, sale_date, customer_name, reference_no, notes } = body;

    if (!provider || !PROVIDERS.includes(provider)) {
      return NextResponse.json({ error: 'Valid provider is required' }, { status: 400 });
    }
    if (amount == null || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
      return NextResponse.json({ error: 'Amount must be greater than 0' }, { status: 400 });
    }

    db.prepare(`
      UPDATE financing_sales SET
        provider=?, amount=?, sale_date=?, customer_name=?, reference_no=?, notes=?
      WHERE id=?
    `).run(
      provider, Number(amount), sale_date || null, customer_name?.trim() || null,
      reference_no?.trim() || null, notes?.trim() || null, params.id
    );

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getDb();
    db.prepare('DELETE FROM financing_sales WHERE id=?').run(params.id);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
