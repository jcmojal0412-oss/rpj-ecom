import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const db = getDb();
    const businessId = req.nextUrl.searchParams.get('business_id');
    if (!businessId) return NextResponse.json({ error: 'business_id is required' }, { status: 400 });

    const shift = db.prepare(
      `SELECT * FROM pos_shifts WHERE business_id = ? AND cashier_id = ? AND status = 'Open'`
    ).get(businessId, session.id);

    return NextResponse.json({ shift: shift ?? null });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
