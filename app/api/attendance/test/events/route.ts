import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getEmployeeDayState, type AttendanceEvent, type EventType } from '@/lib/attendance';
import { loadGlobalBreakSettings, mergeIntoSettings, getShiftForEmployeeOnDate, getEmployeeById, type ShiftTemplate } from '@/lib/attendance-shifts';

export const dynamic = 'force-dynamic';

const VALID_TYPES: EventType[] = ['TIME_IN', 'COFFEE_OUT', 'COFFEE_IN', 'LUNCH_OUT', 'LUNCH_IN', 'TIME_OUT'];

const CAN_FLAG: Record<EventType, keyof ReturnType<typeof getEmployeeDayState>> = {
  TIME_IN: 'canTimeIn',
  COFFEE_OUT: 'canCoffeeOut',
  COFFEE_IN: 'canCoffeeIn',
  LUNCH_OUT: 'canLunchOut',
  LUNCH_IN: 'canLunchIn',
  TIME_OUT: 'canTimeOut',
};

function requireAdmin(session: Awaited<ReturnType<typeof getSession>>) {
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('attendance')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }
  return null;
}

// Admin/owner-only Test/Simulation Mode. Every row this route touches is
// tagged is_test = 1 — every real read path (today, clock, records,
// live-status, the background jobs) explicitly filters is_test = 0, so
// nothing created or deleted here can ever appear in a real employee's
// attendance history, a real report, or feed a real OT/payroll-ready total.
export async function GET(req: NextRequest) {
  const session = await getSession();
  const denied = requireAdmin(session);
  if (denied) return denied;

  const employeeId = req.nextUrl.searchParams.get('employee_id');
  const date = req.nextUrl.searchParams.get('date');
  if (!employeeId || !date) return NextResponse.json({ error: 'employee_id and date are required' }, { status: 400 });

  const db = getDb();
  const events = db.prepare(`
    SELECT id, event_type, event_time, superseded_by FROM attendance_events
    WHERE employee_id = ? AND event_date = ? AND is_test = 1
    ORDER BY event_time ASC
  `).all(employeeId, date);

  return NextResponse.json(events);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  const denied = requireAdmin(session);
  if (denied) return denied;

  try {
    const body = await req.json();
    const employeeId: number = Number(body.employee_id);
    const eventDate: string = body.event_date;
    const eventType: EventType = body.event_type;
    const time: string = body.time; // "HH:MM", PH-local
    const shiftId: number | undefined = body.shift_id ? Number(body.shift_id) : undefined;

    if (!employeeId || !eventDate || !VALID_TYPES.includes(eventType) || !/^\d{2}:\d{2}$/.test(time || '')) {
      return NextResponse.json({ error: 'employee_id, event_date, event_type, and time (HH:MM) are required' }, { status: 400 });
    }

    const db = getDb();
    if (!getEmployeeById(db, employeeId)) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });

    // Simulating against a chosen shift template (any shift, not just the
    // employee's real assignment) is the whole point of Test Mode — falls
    // back to the employee's actually-assigned shift for that date if none
    // was explicitly picked.
    const shift: ShiftTemplate | null = shiftId
      ? (db.prepare('SELECT * FROM attendance_shifts WHERE id = ?').get(shiftId) as ShiftTemplate | undefined) ?? null
      : getShiftForEmployeeOnDate(db, employeeId, eventDate);
    if (!shift) return NextResponse.json({ error: 'No shift selected and the employee has no assigned shift for this date.' }, { status: 400 });

    const employee = getEmployeeById(db, employeeId)!;
    const settings = mergeIntoSettings(loadGlobalBreakSettings(db), shift, employee.work_days);

    const existing = db.prepare(`
      SELECT id, event_type, event_time, superseded_by FROM attendance_events
      WHERE employee_id = ? AND event_date = ? AND is_test = 1
      ORDER BY event_time ASC
    `).all(employeeId, eventDate) as AttendanceEvent[];

    // Same validation the real clock endpoint uses — simulated sequences
    // must follow the same state machine, so Test Mode actually exercises
    // the real rules (duplicate/out-of-sequence rejection included).
    const dayState = getEmployeeDayState(existing, settings);
    if (!dayState[CAN_FLAG[eventType]]) {
      return NextResponse.json({ error: `Cannot simulate ${eventType} right now (current test-day state: ${dayState.state}).` }, { status: 409 });
    }

    const eventTime = new Date(`${eventDate}T${time}:00+08:00`).toISOString();
    // user_id is a legacy NOT NULL + FK(users.id) column nothing reads
    // anymore, but foreign_keys=ON means it must reference a REAL row —
    // the admin running the simulation always satisfies it when unlinked.
    db.prepare(`
      INSERT INTO attendance_events (employee_id, user_id, event_date, event_type, event_time, source, created_by, is_test)
      VALUES (?, ?, ?, ?, ?, 'clock', ?, 1)
    `).run(employeeId, employee.linked_user_id ?? session!.id, eventDate, eventType, eventTime, session!.id);

    const updated = db.prepare(`
      SELECT id, event_type, event_time, superseded_by FROM attendance_events
      WHERE employee_id = ? AND event_date = ? AND is_test = 1
      ORDER BY event_time ASC
    `).all(employeeId, eventDate) as AttendanceEvent[];

    return NextResponse.json({ ok: true, events: updated, dayState: getEmployeeDayState(updated, settings) }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// Clears simulated data. Always scoped to is_test = 1 — cannot touch real
// events under any parameter combination.
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  const denied = requireAdmin(session);
  if (denied) return denied;

  const employeeId = req.nextUrl.searchParams.get('employee_id');
  const date = req.nextUrl.searchParams.get('date');
  const all = req.nextUrl.searchParams.get('all') === '1';

  const db = getDb();
  let result;
  if (all) {
    result = db.prepare('DELETE FROM attendance_events WHERE is_test = 1').run();
  } else if (employeeId && date) {
    result = db.prepare('DELETE FROM attendance_events WHERE is_test = 1 AND employee_id = ? AND event_date = ?').run(employeeId, date);
  } else {
    return NextResponse.json({ error: 'Provide employee_id and date, or all=1' }, { status: 400 });
  }

  return NextResponse.json({ ok: true, deleted: result.changes });
}
