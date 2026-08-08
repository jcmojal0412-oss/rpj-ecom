import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { todayISO } from '@/lib/attendance';

export const dynamic = 'force-dynamic';

// Powers the HR Dashboard's "Needs Your Attention" panel — one call
// aggregating every actionable item (pending OT, pending corrections,
// pending leave requests, missing Time Out today) so HR never has to hunt
// across separate pages just to see what needs a decision. Reuses the
// exact same queries the dedicated admin pages already use — nothing new
// is computed here, only combined.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('attendance')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const db = getDb();
  const today = todayISO();

  const pendingOt = db.prepare(`
    SELECT o.*, e.full_name AS employee_name FROM attendance_ot_requests o
    JOIN employees e ON e.id = o.employee_id
    WHERE o.status = 'pending' ORDER BY o.event_date DESC
  `).all();

  const pendingCorrections = db.prepare(`
    SELECT c.*, e.full_name AS employee_name FROM attendance_corrections c
    JOIN employees e ON e.id = c.employee_id
    WHERE c.status = 'pending' ORDER BY c.created_at DESC
  `).all();

  const pendingLeave = db.prepare(`
    SELECT lr.*, e.full_name AS employee_name, lt.name AS leave_type_name, lt.paid AS leave_type_paid
    FROM leave_requests lr
    JOIN employees e ON e.id = lr.employee_id
    JOIN leave_types lt ON lt.id = lr.leave_type_id
    WHERE lr.status = 'pending' ORDER BY lr.created_at DESC
  `).all();

  // Any active employee with a Time In today but no Time Out yet, past
  // their own shift's finalization point, isn't necessarily a problem —
  // could just be a long day. We only flag it once it's actually missing
  // by end of day: no active TIME_OUT event at all for today.
  const missingTimeOut = db.prepare(`
    SELECT DISTINCT e.id as employee_id, e.full_name AS employee_name
    FROM attendance_events ev
    JOIN employees e ON e.id = ev.employee_id
    WHERE ev.event_date = ? AND ev.event_type = 'TIME_IN' AND ev.superseded_by IS NULL AND ev.is_test = 0
      AND e.employment_status = 'Active' AND e.attendance_enabled = 1
      AND NOT EXISTS (
        SELECT 1 FROM attendance_events t
        WHERE t.employee_id = e.id AND t.event_date = ? AND t.event_type = 'TIME_OUT' AND t.superseded_by IS NULL AND t.is_test = 0
      )
  `).all(today, today);

  return NextResponse.json({ pendingOt, pendingCorrections, pendingLeave, missingTimeOut });
}
