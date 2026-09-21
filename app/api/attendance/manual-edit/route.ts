import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { applyManualAttendanceEdit, validatePunches, type PunchInput } from '@/lib/attendance-manual';
import { getFinalizedPayrollPeriodFor, refreshOpenPayrollForEmployeeDate } from '@/lib/payroll-data';

export const dynamic = 'force-dynamic';

// HR / owner edits one employee's punches for one day directly (Time In,
// Time Out, lunch and coffee breaks) - no request/approval round trip. Every
// edit needs a reason and is recorded with before/after in the audit log.
// Guard rails: you can't edit your own attendance (unless you're the owner),
// not a future day, and not a day inside a payroll period that is already
// approved/paid/locked. A draft / for-review period is refreshed so the edit
// actually reaches pay.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('attendance')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const employeeId = Number(body.employee_id);
    const date = String(body.date ?? '');
    const reason = String(body.reason ?? '').trim();
    const punches: PunchInput[] = Array.isArray(body.punches)
      ? body.punches.map((p: any) => ({ id: p.id != null ? Number(p.id) : undefined, event_type: p.event_type, time: String(p.time ?? '') }))
      : [];

    if (!employeeId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'employee_id and date (YYYY-MM-DD) are required' }, { status: 400 });
    }
    if (reason.length < 3) return NextResponse.json({ error: 'Please give a reason for this edit.' }, { status: 400 });
    if (!Array.isArray(body.punches)) return NextResponse.json({ error: 'punches must be a list' }, { status: 400 });

    const todayPh = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    if (date > todayPh) return NextResponse.json({ error: 'You can\'t edit attendance for a future date.' }, { status: 400 });

    const problem = validatePunches(punches);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });

    const db = getDb();
    const employee = db.prepare(
      "SELECT id, full_name, linked_user_id FROM employees WHERE id = ? AND employment_status = 'Active' AND attendance_enabled = 1"
    ).get(employeeId) as { id: number; full_name: string; linked_user_id: number | null } | undefined;
    if (!employee) return NextResponse.json({ error: 'Employee not found, inactive, or attendance is not enabled.' }, { status: 404 });

    if (session.role !== 'owner' && employee.linked_user_id === session.id) {
      return NextResponse.json({ error: 'You can\'t edit your own attendance. Ask the owner or another HR user.' }, { status: 403 });
    }

    const finalized = getFinalizedPayrollPeriodFor(db, date);
    if (finalized) {
      return NextResponse.json({
        error: `Payroll "${finalized.label}" is already ${finalized.status} - attendance for ${date} can no longer be edited. Use a payroll adjustment instead.`,
      }, { status: 409 });
    }

    const result = applyManualAttendanceEdit(db, { employee, date, punches, reason, actorId: session.id });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    let payrollNote: string | undefined;
    const refreshed = refreshOpenPayrollForEmployeeDate(db, employee.id, date);
    if (refreshed.length) payrollNote = `Payroll updated: ${refreshed.join(', ')}`;

    return NextResponse.json({ ok: true, before: result.before, after: result.after, ot_notes: result.otNotes, payroll_note: payrollNote });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
