import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const VALID_TYPES = ['official_business', 'authorized_absence', 'company_event'];

function requireAdmin(session: Awaited<ReturnType<typeof getSession>>) {
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('leave_management')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }
  return null;
}

// Admin-recorded exceptions never go through a separate approval step —
// the admin creating the record IS the approval, unlike employee-submitted
// leave requests. lib/attendance-exceptions.ts reads this table live to
// reclassify what would otherwise be an Absent day.
export async function GET(req: NextRequest) {
  const session = await getSession();
  const denied = requireAdmin(session);
  if (denied) return denied;

  const db = getDb();
  const employeeId = req.nextUrl.searchParams.get('employee_id');
  const rows = employeeId
    ? db.prepare(`
        SELECT ex.*, e.full_name AS employee_name FROM attendance_exceptions ex
        JOIN employees e ON e.id = ex.employee_id
        WHERE ex.employee_id = ? ORDER BY ex.from_date DESC
      `).all(employeeId)
    : db.prepare(`
        SELECT ex.*, e.full_name AS employee_name FROM attendance_exceptions ex
        JOIN employees e ON e.id = ex.employee_id
        ORDER BY ex.from_date DESC
      `).all();

  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  const denied = requireAdmin(session);
  if (denied) return denied;

  try {
    const body = await req.json();
    const { employee_id, exception_type, from_date, to_date, reason } = body;

    if (!employee_id || !VALID_TYPES.includes(exception_type) || !from_date || !to_date) {
      return NextResponse.json({ error: 'employee_id, exception_type, from_date, and to_date are required' }, { status: 400 });
    }
    if (to_date < from_date) {
      return NextResponse.json({ error: 'To Date cannot be before From Date' }, { status: 400 });
    }

    const db = getDb();
    const employee = db.prepare('SELECT id FROM employees WHERE id = ?').get(employee_id);
    if (!employee) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });

    const info = db.prepare(`
      INSERT INTO attendance_exceptions (employee_id, exception_type, from_date, to_date, paid, reason, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(employee_id, exception_type, from_date, to_date, body.paid === false ? 0 : 1, reason || null, session!.id);

    return NextResponse.json({ id: Number(info.lastInsertRowid) }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
