import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { todayISO } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// Powers the "Financing Sales" KPI card on the main Operations Dashboard.
// Computed server-side (rather than the client fetching /api/financing-sales
// directly) so a user without the 'financing' permission simply gets
// available:false instead of the middleware redirect that route would
// otherwise trigger for them.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('financing')) {
    return NextResponse.json({ available: false, total: 0, prevTotal: null });
  }

  const db = getDb();
  const today = todayISO();
  const { searchParams } = req.nextUrl;
  const from = searchParams.get('from') || today;
  const to = searchParams.get('to') || today;
  const prevFrom = searchParams.get('prevFrom');
  const prevTo = searchParams.get('prevTo');

  const sumRange = (f: string, t: string) => (db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total FROM financing_sales
    WHERE sale_date IS NOT NULL AND sale_date BETWEEN ? AND ?
  `).get(f, t) as { total: number }).total;

  const total = sumRange(from, to);
  const prevTotal = (prevFrom && prevTo) ? sumRange(prevFrom, prevTo) : null;

  return NextResponse.json({ available: true, total, prevTotal });
}
