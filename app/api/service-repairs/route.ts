import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

const SPLIT_BNS = 0.6;
const SPLIT_GERALD = 0.4;

export async function GET() {
  try {
    const db = getDb();
    const rows = db.prepare(
      'SELECT * FROM service_repairs ORDER BY repair_date DESC, id DESC'
    ).all();

    const totals = db.prepare(`
      SELECT
        COALESCE(SUM(cs_payment),0)   as total_cs_payment,
        COALESCE(SUM(cogs),0)         as total_cogs,
        COALESCE(SUM(labor_amount),0) as total_labor,
        COALESCE(SUM(bns_share),0)    as total_bns,
        COALESCE(SUM(gerald_share),0) as total_gerald,
        COALESCE(SUM(dp),0)           as total_dp,
        SUM(CASE WHEN status='ONGOING' THEN 1 ELSE 0 END) as ongoing_count,
        SUM(CASE WHEN paid_to_tech=0 THEN gerald_share ELSE 0 END) as gerald_unpaid
      FROM service_repairs
    `).get();

    return NextResponse.json({ rows, totals });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = getDb();
    const {
      repair_date, repair_details, unit_model, cs_payment, cogs,
      dp, status, paid_to_tech, tech_paid_date,
    } = await req.json();

    if (!repair_date) {
      return NextResponse.json({ error: 'repair_date is required' }, { status: 400 });
    }

    const csNum   = cs_payment ? parseFloat(cs_payment) : 0;
    const cogsNum = cogs ? parseFloat(cogs) : 0;
    const labor   = csNum - cogsNum;
    const bns     = labor * SPLIT_BNS;
    const gerald  = labor * SPLIT_GERALD;

    const info = db.prepare(`
      INSERT INTO service_repairs
        (repair_date, repair_details, unit_model, cs_payment, cogs, labor_amount,
         bns_share, gerald_share, dp, status, paid_to_tech, tech_paid_date)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      repair_date, repair_details ?? null, unit_model ?? null,
      csNum, cogsNum, labor, bns, gerald,
      dp ? parseFloat(dp) : 0,
      status ?? 'ONGOING',
      paid_to_tech ? 1 : 0,
      tech_paid_date ?? null,
    );

    return NextResponse.json({ id: info.lastInsertRowid }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
