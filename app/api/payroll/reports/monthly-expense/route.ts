import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { todayISO } from '@/lib/utils';
import { buildMonthlyExpense, type Basis, type GroupBy } from '@/lib/payroll-expense';

export const dynamic = 'force-dynamic';

// Company-wide payroll cost is Owner / Payroll-permission only — an employee
// (or anyone without the payroll module) never gets it. Read-only: this route
// only reports what payroll already recorded.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('payroll')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const q = req.nextUrl.searchParams;
  const today = todayISO();
  const basisParam = q.get('basis');
  const basis = (['paid', 'approved_paid', 'all'].includes(basisParam ?? '') ? basisParam : 'approved_paid') as Basis;
  const groupBy = (q.get('group') === 'pay_date' ? 'pay_date' : 'period_end') as GroupBy;
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(q.get('month') ?? '') ? (q.get('month') as string) : today.slice(0, 7);

  try {
    const data = buildMonthlyExpense(getDb(), { month, basis, groupBy, schedule: q.get('schedule') || null, department: q.get('department') || null, today });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
