import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db   = getDb();
    const body = await req.json();
    db.prepare(`
      UPDATE partners SET
        name=?,contact=?,schedule=?,remarks=?,subscription=?,price=?,assist_by=?,commission=?,
        referred_by=?,contract_signing=?,onboarding=?,start_ads=?,company_name=?,email=?,
        bank=?,acct_name=?,acct_number=?,notes=?
      WHERE id=?
    `).run(
      body.name, body.contact ?? null, body.schedule ?? null, body.remarks ?? null,
      body.subscription ?? null, body.price ?? 0, body.assist_by ?? null, body.commission ?? null,
      body.referred_by ?? null, body.contract_signing ?? null, body.onboarding ?? null,
      body.start_ads ?? null, body.company_name ?? null, body.email ?? null,
      body.bank ?? null, body.acct_name ?? null, body.acct_number ?? null, body.notes ?? null,
      params.id
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getDb();
    db.prepare('DELETE FROM partners WHERE id=?').run(params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
