import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

function requireAdmin(session: Awaited<ReturnType<typeof getSession>>) {
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('attendance')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }
  return null;
}

// Lists date-specific overrides for one employee (past + upcoming) — never
// touches the default-shift assignment history in attendance_shift_assignments.
export async function GET(req: NextRequest) {
  const session = await getSession();
  const denied = requireAdmin(session);
  if (denied) return denied;

  const employeeId = req.nextUrl.searchParams.get('employee_id');
  if (!employeeId) return NextResponse.json({ error: 'employee_id is required' }, { status: 400 });

  const db = getDb();
  const rows = db.prepare(`
    SELECT o.id, o.override_date, o.reason, o.shift_id, s.name as shift_name, s.start_time, s.end_time
    FROM attendance_shift_overrides o
    JOIN attendance_shifts s ON s.id = o.shift_id
    WHERE o.employee_id = ?
    ORDER BY o.override_date DESC
  `).all(Number(employeeId));

  return NextResponse.json(rows);
}

// Creates (or replaces, if one already exists for that exact date) a
// one-off override — applies to exactly ONE date and never rewrites the
// employee's default shift assignment.
export async function POST(req: NextRequest) {
  const session = await getSession();
  const denied = requireAdmin(session);
  if (denied) return denied;

  try {
    const { employee_id, date, shift_id, reason } = await req.json();
    if (!employee_id || !date || !shift_id) {
      return NextResponse.json({ error: 'employee_id, date, and shift_id are required' }, { status: 400 });
    }

    const db = getDb();
    const employee = db.prepare('SELECT id FROM employees WHERE id = ?').get(employee_id);
    if (!employee) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
    const shift = db.prepare('SELECT id FROM attendance_shifts WHERE id = ?').get(shift_id);
    if (!shift) return NextResponse.json({ error: 'Shift template not found' }, { status: 404 });

    db.prepare(`
      INSERT INTO attendance_shift_overrides (employee_id, override_date, shift_id, reason, created_by)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(employee_id, override_date) DO UPDATE SET
        shift_id = excluded.shift_id, reason = excluded.reason, created_by = excluded.created_by, created_at = datetime('now')
    `).run(employee_id, date, shift_id, reason || null, session!.id);

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
