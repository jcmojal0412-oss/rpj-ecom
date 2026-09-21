import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { ensureOvertimeRequest } from '@/lib/attendance-jobs';

export const dynamic = 'force-dynamic';

// Daily Records shows "Potential OT" computed live from the punches, so a day
// the background flagger never reached has no request to review. This creates
// (or just returns) the pending request for one employee/day — the minutes are
// always recomputed server-side from the real punches, never taken from the
// client, and it never approves anything.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('attendance')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  try {
    const { employee_id, event_date } = await req.json();
    if (!employee_id || !/^\d{4}-\d{2}-\d{2}$/.test(String(event_date ?? ''))) {
      return NextResponse.json({ error: 'employee_id and event_date (YYYY-MM-DD) are required' }, { status: 400 });
    }
    const request = ensureOvertimeRequest(Number(employee_id), String(event_date));
    if (!request) {
      return NextResponse.json({ error: 'No overtime qualifies for this day, so there is nothing to review.' }, { status: 404 });
    }
    return NextResponse.json(request);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
