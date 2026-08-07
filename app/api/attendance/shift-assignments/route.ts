import { NextRequest, NextResponse } from 'next/server';
import { getDb, runTransaction } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { todayISO } from '@/lib/attendance';
import { getShiftForEmployeeOnDate } from '@/lib/attendance-shifts';

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
// lib/attendance-shifts.ts's getShiftForEmployeeOnDate), which may differ
// from today's assignment for past dates.
export async function GET() {
  const session = await getSession();
  const denied = requireAdmin(session);
  if (denied) return denied;

  const db = getDb();
  const today = todayISO();
  const employees = db.prepare(
    "SELECT id, full_name FROM employees WHERE employment_status = 'Active' ORDER BY full_name ASC"
  ).all() as { id: number; full_name: string }[];

  const assignments = employees.map(e => ({
    employee_id: e.id,
    name: e.full_name,
    shift: getShiftForEmployeeOnDate(db, e.id, today),
  }));

  return NextResponse.json(assignments);
}

// Reassigns an employee (or, via employee_ids, multiple employees at once —
// Bulk Shift Assignment) to a new shift, effective from a given date.
// Closes any currently-open assignment (effective_to IS NULL) the day
// before the new one starts, then inserts the new open-ended assignment.
// Past attendance_events/computed summaries are untouched — the new
// assignment only governs dates >= effective_from going forward. This
// becomes each employee's new "Default Shift" — applied automatically to
// every future date with no need to reassign daily.
export async function POST(req: NextRequest) {
  const session = await getSession();
  const denied = requireAdmin(session);
  if (denied) return denied;

  try {
    const body = await req.json();
    const { shift_id, effective_from } = body;
    const employeeIds: number[] = Array.isArray(body.employee_ids)
      ? body.employee_ids
      : body.employee_id ? [body.employee_id] : [];

    if (!employeeIds.length || !shift_id || !effective_from) {
      return NextResponse.json({ error: 'employee_id (or employee_ids), shift_id, and effective_from are required' }, { status: 400 });
    }

    const db = getDb();
    const shift = db.prepare('SELECT id FROM attendance_shifts WHERE id = ?').get(shift_id);
    if (!shift) return NextResponse.json({ error: 'Shift template not found' }, { status: 404 });

    const dayBefore = new Date(new Date(effective_from + 'T00:00:00').getTime() - 86_400_000).toISOString().slice(0, 10);
    let count = 0;

    runTransaction(() => {
      for (const employeeId of employeeIds) {
        const employee = db.prepare('SELECT id, linked_user_id FROM employees WHERE id = ?').get(employeeId) as { id: number; linked_user_id: number | null } | undefined;
        if (!employee) continue;
        // user_id is a legacy NOT NULL column nothing reads anymore.
        const legacyUserId = employee.linked_user_id ?? -employee.id;

        db.prepare(`
          UPDATE attendance_shift_assignments SET effective_to = ?
          WHERE employee_id = ? AND effective_to IS NULL
        `).run(dayBefore, employeeId);

        db.prepare(`
          INSERT INTO attendance_shift_assignments (employee_id, user_id, shift_id, effective_from, created_by)
          VALUES (?, ?, ?, ?, ?)
        `).run(employeeId, legacyUserId, shift_id, effective_from, session!.id);
        count++;
      }
    });

    if (!count) return NextResponse.json({ error: 'No matching employees found' }, { status: 404 });
    return NextResponse.json({ ok: true, count }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
