import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { buildDetailQuery, computeRows, type DetailRow } from '@/lib/pos-product-report';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const { sql, params } = buildDetailQuery(req);
    const raw = db.prepare(sql).all(...params) as DetailRow[];
    return NextResponse.json({ rows: computeRows(raw) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
