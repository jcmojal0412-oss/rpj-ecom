import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { findEmployeeByIdentifier } from '@/lib/attendance-shifts';
import { getTodayStateForEmployee } from '@/lib/attendance-clock';

export const dynamic = 'force-dynamic';

// Unauthenticated by design (see middleware.ts PUBLIC list) — this is the
// kiosk's entire "sign-in" step. Deliberately returns the same generic
// error on every kind of miss (not found vs. inactive vs. no shift) so it
// can't be used to enumerate who's a real employee. Response is kept
// minimal (name + code only) — never email, mobile, salary, etc.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const identifier: string = body.identifier || '';

    const db = getDb();
    const employee = findEmployeeByIdentifier(db, identifier);
    if (!employee) {
      return NextResponse.json({ error: 'Employee not found. Please check your ID, email, or mobile number.' }, { status: 404 });
    }

    const state = getTodayStateForEmployee(db, employee);
    if (!state) {
      return NextResponse.json({ error: 'No shift assigned for this employee. Please contact an administrator.' }, { status: 409 });
    }

    const employeeCode = `RPJ-${String(employee.id).padStart(4, '0')}`;

    return NextResponse.json({
      employee_id: employee.id,
      full_name: employee.full_name,
      employee_code: employeeCode,
      dayState: state.dayState,
      requiresSelfie: state.requiresSelfie,
      settings: { coffee_break_minutes: state.settings.coffee_break_minutes, lunch_break_minutes: state.settings.lunch_break_minutes },
      events: state.events,
    });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
