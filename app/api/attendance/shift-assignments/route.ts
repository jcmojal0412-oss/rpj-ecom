import { NextRequest, NextResponse } from 'next/server';
import { getDb, runTransaction } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { todayISO } from '@/lib/attendance';
import { getShiftForUserOnDate } from '@/lib/attendance-shifts';

export const dynamic = 'force-dynamic';

function requireAdmin(session: Awaited<ReturnType<typeof getSession>>) {
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('attendance')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }
  return null;
}

// Each active employee's shift AS OF TODAY — for display/management only.
// Attendance calculations never call this directly; they always resolve
// the shift that was in effect on the SPECIFIC date being computed (see
// lib/attendance-shifts.ts's getShiftForUserOnDate), which may differ from
// today's assignment for past dates.
export async function GET() {
  const session = await getSession();
  const denied = requireAdmin(session);
  if (denied) return denied;

  const db = getDb();
  const today = todayISO();
  const users = db.prepare('SELECT id, name FROM users WHERE active = 1 ORDER BY name ASC').all() as { id: number; name: string }[];

  const assignments = users.map(u => ({
    user_id: u.id,
    name: u.name,
    shift: getShiftForUserOnDate(db, u.id, today),
  }));

  return NextResponse.json(assignments);
}

// Reassigns an employee to a new shift, effective from a given date.
// Closes any currently-open assignment (effective_to IS NULL) the day
// before the new one starts, then inserts the new open-ended assignment.
// Past attendance_events/computed summaries are untouched — the new
// assignment only governs dates >= effective_from going forward.
export async function POST(req: NextRequest) {
  const session = await getSession();
  const denied = requireAdmin(session);
  if (denied) return denied;

  try {
    const { user_id, shift_id, effective_from } = await req.json();
    if (!user_id || !shift_id || !effective_from) {
      return NextResponse.json({ error: 'user_id, shift_id, and effective_from are required' }, { status: 400 });
    }

    const db = getDb();
    const shift = db.prepare('SELECT id FROM attendance_shifts WHERE id = ?').get(shift_id);
    if (!shift) return NextResponse.json({ error: 'Shift template not found' }, { status: 404 });

    const dayBefore = new Date(new Date(effective_from + 'T00:00:00').getTime() - 86_400_000).toISOString().slice(0, 10);

    runTransaction(() => {
      db.prepare(`
        UPDATE attendance_shift_assignments SET effective_to = ?
        WHERE user_id = ? AND effective_to IS NULL
      `).run(dayBefore, user_id);

      db.prepare(`
        INSERT INTO attendance_shift_assignments (user_id, shift_id, effective_from, created_by)
        VALUES (?, ?, ?, ?)
      `).run(user_id, shift_id, effective_from, session!.id);
    });

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
