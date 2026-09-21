import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { buildMonitor, listPeriods } from '@/lib/payslip-monitor';

export const dynamic = 'force-dynamic';

// Payroll Monitoring data for the Payslips page: the period list for the
// selector plus everything for the selected period (defaults to the latest).
// Owner or anyone with the Payroll permission only — an employee never gets
// other people's payroll from here (they use /api/payslips, which only ever
// returns their own released payslips).
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('payroll')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  try {
    const db = getDb();
    const periods = listPeriods(db);
    if (periods.length === 0) return NextResponse.json({ periods: [], data: null });

    const requested = Number(req.nextUrl.searchParams.get('period_id'));
    const chosen = periods.find(p => p.id === requested) ?? periods[0];
    return NextResponse.json({ periods, data: buildMonitor(db, chosen.id) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
