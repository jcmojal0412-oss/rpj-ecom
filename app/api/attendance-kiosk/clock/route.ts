import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getEmployeeById } from '@/lib/attendance-shifts';
import { recordClockEvent } from '@/lib/attendance-clock';
import { type EventType } from '@/lib/attendance';

export const dynamic = 'force-dynamic';

const VALID_TYPES: EventType[] = ['TIME_IN', 'COFFEE_OUT', 'COFFEE_IN', 'LUNCH_OUT', 'LUNCH_IN', 'TIME_OUT'];

// Unauthenticated by design (see middleware.ts PUBLIC list). Never trusts
// the employee_id the kiosk UI remembered from its earlier /lookup call —
// re-validates it's still a real, Active, Attendance Enabled employee on
// every request, then hands off to the exact same recordClockEvent() the
// logged-in self-clock route uses, so the actual attendance rules are
// never duplicated or diverged.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const employeeId = Number(body.employee_id);
    const eventType: EventType = body.event_type;
    const photoPath: string | null = body.photo_path || null;

    if (!employeeId || !VALID_TYPES.includes(eventType)) {
      return NextResponse.json({ error: 'employee_id and a valid event_type are required' }, { status: 400 });
    }

    const db = getDb();
    const employee = getEmployeeById(db, employeeId);
    if (!employee || employee.employment_status !== 'Active' || !employee.attendance_enabled) {
      return NextResponse.json({ error: 'Employee not found or not eligible for attendance.' }, { status: 404 });
    }

    const result = recordClockEvent(db, employee, eventType, photoPath, null);
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });

    return NextResponse.json({ ok: true, dayState: result.dayState, events: result.events });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
