import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

const SPLIT_BNS = 0.6;
const SPLIT_GERALD = 0.4;

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getDb();
    const {
      repair_date, repair_details, unit_model, cs_payment, cogs,
      dp, status, paid_to_tech, tech_paid_date,
    } = await req.json();

    const csNum   = cs_payment ? parseFloat(cs_payment) : 0;
    const cogsNum = cogs ? parseFloat(cogs) : 0;
    const labor   = csNum - cogsNum;
    const bns     = labor * SPLIT_BNS;
    const gerald  = labor * SPLIT_GERALD;

    const info = db.prepare(`
      UPDATE service_repairs SET
        repair_date=?, repair_details=?, unit_model=?, cs_payment=?, cogs=?, labor_amount=?,
        bns_share=?, gerald_share=?, dp=?, status=?, paid_to_tech=?, tech_paid_date=?
      WHERE id=?
    `).run(
      repair_date, repair_details ?? null, unit_model ?? null,
      csNum, cogsNum, labor, bns, gerald,
      dp ? parseFloat(dp) : 0,
      status ?? 'ONGOING',
      paid_to_tech ? 1 : 0,
      tech_paid_date ?? null,
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
    db.prepare('DELETE FROM service_repairs WHERE id=?').run(params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
