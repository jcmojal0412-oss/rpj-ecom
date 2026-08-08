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

  // Employee 201 File "Leave History" tab — explicit employee_id lookup.
  // Kept as its own branch (never falls through to the "self" path below)
  // so an admin without leave_management never silently sees their OWN
  // leave requests mislabeled as someone else's on a profile page.
  const employeeIdParam = req.nextUrl.searchParams.get('employee_id');
  if (employeeIdParam) {
    if (!isAdmin) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    const rows = db.prepare(`
      SELECT lr.*, lt.name AS leave_type_name, lt.paid AS leave_type_paid
      FROM leave_requests lr JOIN leave_types lt ON lt.id = lr.leave_type_id
      WHERE lr.employee_id = ? ORDER BY lr.from_date DESC
    `).all(employeeIdParam);
    return NextResponse.json(rows);
  }

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

  try {
    const body = await req.json();
    const { leave_type_id, from_date, to_date, day_type, reason, attachment_path, employee_id } = body;

    // An admin filing on behalf of someone else passes employee_id
    // explicitly (see EmployeeProfileClient's Leave tab) — everyone else
    // (including an admin with no employee_id) files for themselves,
    // exactly as before.
    let targetEmployeeId: number;
    const isAdmin = session.role === 'owner' || session.permissions.includes('leave_management');
    if (employee_id && isAdmin) {
      const target = db.prepare(`SELECT id FROM employees WHERE id = ? AND employment_status = 'Active'`).get(employee_id);
      if (!target) return NextResponse.json({ error: 'Employee not found or not active.' }, { status: 404 });
      targetEmployeeId = employee_id;
    } else {
      const employee = getActiveEmployeeForUser(db, session.id);
      if (!employee) {
        return NextResponse.json({ error: 'You are not linked to an active employee record. Please contact HR/Admin.' }, { status: 409 });
      }
      targetEmployeeId = employee.id;
    }

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
    `).run(targetEmployeeId, leave_type_id, from_date, to_date, day_type === 'half' ? 'half' : 'full', reason.trim(), attachment_path || null);

    return NextResponse.json({ id: Number(info.lastInsertRowid) }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
