import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import {
  getEmployeeDayState, eventRequiresSelfie, todayISO,
  type AttendanceEvent, type EventType,
} from '@/lib/attendance';
import { resolveAttendanceSettings } from '@/lib/attendance-shifts';

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

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  try {
    const body = await req.json();
    const eventType: EventType = body.event_type;
    const photoPath: string | null = body.photo_path || null;

    if (!VALID_TYPES.includes(eventType)) {
      return NextResponse.json({ error: 'Invalid event_type' }, { status: 400 });
    }

    const db = getDb();
    const today = todayISO();

    const resolved = resolveAttendanceSettings(db, session.id, today);
    if (!resolved) return NextResponse.json({ error: 'No shift assigned. Please contact an administrator.' }, { status: 409 });
    const { settings } = resolved;

    if (eventRequiresSelfie(eventType, settings) && !photoPath) {
      return NextResponse.json({ error: 'A selfie photo is required for this action.' }, { status: 400 });
    }

    const events = db.prepare(`
      SELECT id, event_type, event_time, superseded_by FROM attendance_events
      WHERE user_id = ? AND event_date = ? AND is_test = 0
      ORDER BY event_time ASC
    `).all(session.id, today) as AttendanceEvent[];

    // Re-derive server-side — never trust the client's idea of what state
    // it's in. This is what rejects duplicate/out-of-sequence actions
    // (e.g. Time In twice, exceeding allowed coffee breaks, Time Out from
    // a break).
    const dayState = getEmployeeDayState(events, settings);
    if (!dayState[CAN_FLAG[eventType]]) {
      return NextResponse.json({ error: `Cannot record ${eventType} right now (current state: ${dayState.state}).` }, { status: 409 });
    }

    const eventTime = new Date().toISOString();
    db.prepare(`
      INSERT INTO attendance_events (user_id, event_date, event_type, event_time, photo_path, source, created_by)
      VALUES (?, ?, ?, ?, ?, 'clock', ?)
    `).run(session.id, today, eventType, eventTime, photoPath, session.id);

    const updatedEvents = db.prepare(`
      SELECT id, event_type, event_time, superseded_by FROM attendance_events
      WHERE user_id = ? AND event_date = ? AND is_test = 0
      ORDER BY event_time ASC
    `).all(session.id, today) as AttendanceEvent[];

    return NextResponse.json({ ok: true, dayState: getEmployeeDayState(updatedEvents, settings), events: updatedEvents });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
