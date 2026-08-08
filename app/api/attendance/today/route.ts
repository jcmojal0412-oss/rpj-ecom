import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getActiveEmployeeForUser } from '@/lib/attendance-shifts';
import { getTodayStateForEmployee } from '@/lib/attendance-clock';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const db = getDb();
  const employee = getActiveEmployeeForUser(db, session.id);
  if (!employee) {
    return NextResponse.json({ error: 'You are not linked to an active employee record. Please contact HR/Admin.' }, { status: 409 });
  }

  const state = getTodayStateForEmployee(db, employee);
  if (!state) return NextResponse.json({ error: 'No shift assigned. Please contact an administrator.' }, { status: 409 });

  return NextResponse.json({ ...state, employee: { id: employee.id, full_name: employee.full_name } });
}
