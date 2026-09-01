import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getActiveEmployeeForUser } from '@/lib/attendance-shifts';

export const dynamic = 'force-dynamic';

// Raw punches (with photo_path, for the selfie viewer) for one employee on
// one date — nothing else currently exposes photo_path to a client (see
// /api/attendance/photos/[filename], the only other reader of that column).
// Admin (owner/'attendance') can view anyone; a plain employee can only
// view their own day, matching the same self-vs-admin split the photo
// route itself already enforces.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const employeeId = Number(req.nextUrl.searchParams.get('employee_id'));
  const date = req.nextUrl.searchParams.get('date');
  if (!employeeId || !date) return NextResponse.json({ error: 'employee_id and date are required' }, { status: 400 });

  const isAdmin = session.role === 'owner' || session.permissions.includes('attendance');
  if (!isAdmin) {
    const db0 = getDb();
    const callerEmployee = getActiveEmployeeForUser(db0, session.id);
    if (!callerEmployee || callerEmployee.id !== employeeId) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }
  }

  const db = getDb();
  const events = db.prepare(`
    SELECT id, event_type, event_time, photo_path
    FROM attendance_events
    WHERE employee_id = ? AND event_date = ? AND superseded_by IS NULL AND is_test = 0
    ORDER BY event_time ASC
  `).all(employeeId, date);

  return NextResponse.json({ events });
}
