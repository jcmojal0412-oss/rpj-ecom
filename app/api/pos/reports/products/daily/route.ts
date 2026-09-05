import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { buildDailyDetailQuery, type DailyDetailRow } from '@/lib/pos-product-report';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const { sql, params } = buildDailyDetailQuery(req);
    const rows = db.prepare(sql).all(...params) as DailyDetailRow[];
    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
