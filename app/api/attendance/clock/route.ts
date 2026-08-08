import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { type EventType } from '@/lib/attendance';
import { getActiveEmployeeForUser } from '@/lib/attendance-shifts';
import { recordClockEvent } from '@/lib/attendance-clock';

export const dynamic = 'force-dynamic';

const VALID_TYPES: EventType[] = ['TIME_IN', 'COFFEE_OUT', 'COFFEE_IN', 'LUNCH_OUT', 'LUNCH_IN', 'TIME_OUT'];

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
    const employee = getActiveEmployeeForUser(db, session.id);
    if (!employee) {
      return NextResponse.json({ error: 'You are not linked to an active employee record. Please contact HR/Admin.' }, { status: 409 });
    }

    const result = recordClockEvent(db, employee, eventType, photoPath, session.id);
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });

    return NextResponse.json({ ok: true, dayState: result.dayState, events: result.events });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
