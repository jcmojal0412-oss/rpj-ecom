import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getActiveEmployeeForUser } from '@/lib/attendance-shifts';
import type { EventType } from '@/lib/attendance';

export const dynamic = 'force-dynamic';

const VALID_TYPES: EventType[] = ['TIME_IN', 'COFFEE_OUT', 'COFFEE_IN', 'LUNCH_OUT', 'LUNCH_IN', 'TIME_OUT'];

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const db = getDb();
  const selfOnly = req.nextUrl.searchParams.get('self') === '1';
  const isAdmin = !selfOnly && (session.role === 'owner' || session.permissions.includes('attendance'));

  if (isAdmin) {
    const status = req.nextUrl.searchParams.get('status');
    const rows = status
      ? db.prepare(`
          SELECT c.*, e.full_name AS employee_name FROM attendance_corrections c
          JOIN employees e ON e.id = c.employee_id
          WHERE c.status = ? ORDER BY c.created_at DESC
        `).all(status)
      : db.prepare(`
          SELECT c.*, e.full_name AS employee_name FROM attendance_corrections c
          JOIN employees e ON e.id = c.employee_id
          ORDER BY c.created_at DESC
        `).all();
    return NextResponse.json(rows);
  }

  const employee = getActiveEmployeeForUser(db, session.id);
  if (!employee) return NextResponse.json([]);
  const rows = db.prepare('SELECT * FROM attendance_corrections WHERE employee_id = ? ORDER BY created_at DESC').all(employee.id);
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const db = getDb();

  try {
    const body = await req.json();
    const { event_date, original_event_id, requested_event_type, requested_time, reason, employee_id } = body;

    // An admin filing on behalf of someone else passes employee_id
    // explicitly (see EmployeeProfileClient's Attendance tab) — everyone
    // else (including an admin with no employee_id) files for themselves,
    // exactly as before.
    let targetEmployeeId: number;
    const isAdmin = session.role === 'owner' || session.permissions.includes('attendance');
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

    if (!event_date || !requested_event_type || !requested_time || !reason?.trim()) {
      return NextResponse.json({ error: 'event_date, requested_event_type, requested_time, and reason are required' }, { status: 400 });
    }
    if (!VALID_TYPES.includes(requested_event_type)) {
      return NextResponse.json({ error: 'Invalid requested_event_type' }, { status: 400 });
    }

    const info = db.prepare(`
      INSERT INTO attendance_corrections (employee_id, user_id, event_date, original_event_id, requested_event_type, requested_time, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(targetEmployeeId, session.id, event_date, original_event_id || null, requested_event_type, requested_time, reason.trim());

    return NextResponse.json({ id: Number(info.lastInsertRowid) }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
