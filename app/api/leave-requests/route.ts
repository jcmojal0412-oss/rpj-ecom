import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getActiveEmployeeForUser } from '@/lib/attendance-shifts';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const db = getDb();
  const selfOnly = req.nextUrl.searchParams.get('self') === '1';
  const isAdmin = !selfOnly && (session.role === 'owner' || session.permissions.includes('leave_management'));

  if (isAdmin) {
    const status = req.nextUrl.searchParams.get('status');
    const rows = status
      ? db.prepare(`
          SELECT lr.*, e.full_name AS employee_name, lt.name AS leave_type_name, lt.paid AS leave_type_paid
          FROM leave_requests lr
          JOIN employees e ON e.id = lr.employee_id
          JOIN leave_types lt ON lt.id = lr.leave_type_id
          WHERE lr.status = ? ORDER BY lr.created_at DESC
        `).all(status)
      : db.prepare(`
          SELECT lr.*, e.full_name AS employee_name, lt.name AS leave_type_name, lt.paid AS leave_type_paid
          FROM leave_requests lr
          JOIN employees e ON e.id = lr.employee_id
          JOIN leave_types lt ON lt.id = lr.leave_type_id
          ORDER BY lr.created_at DESC
        `).all();
    return NextResponse.json(rows);
  }

  const employee = getActiveEmployeeForUser(db, session.id);
  if (!employee) return NextResponse.json([]);
  const rows = db.prepare(`
    SELECT lr.*, lt.name AS leave_type_name, lt.paid AS leave_type_paid
    FROM leave_requests lr JOIN leave_types lt ON lt.id = lr.leave_type_id
    WHERE lr.employee_id = ? ORDER BY lr.created_at DESC
  `).all(employee.id);
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const db = getDb();
  const employee = getActiveEmployeeForUser(db, session.id);
  if (!employee) {
    return NextResponse.json({ error: 'You are not linked to an active employee record. Please contact HR/Admin.' }, { status: 409 });
  }

  try {
    const body = await req.json();
    const { leave_type_id, from_date, to_date, day_type, reason, attachment_path } = body;

    if (!leave_type_id || !from_date || !to_date || !reason?.trim()) {
      return NextResponse.json({ error: 'leave_type_id, from_date, to_date, and reason are required' }, { status: 400 });
    }
    if (to_date < from_date) {
      return NextResponse.json({ error: 'To Date cannot be before From Date' }, { status: 400 });
    }
    const leaveType = db.prepare('SELECT id FROM leave_types WHERE id = ? AND active = 1').get(leave_type_id);
    if (!leaveType) return NextResponse.json({ error: 'Invalid or inactive leave type' }, { status: 400 });

    const info = db.prepare(`
      INSERT INTO leave_requests (employee_id, leave_type_id, from_date, to_date, day_type, reason, attachment_path)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(employee.id, leave_type_id, from_date, to_date, day_type === 'half' ? 'half' : 'full', reason.trim(), attachment_path || null);

    return NextResponse.json({ id: Number(info.lastInsertRowid) }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
