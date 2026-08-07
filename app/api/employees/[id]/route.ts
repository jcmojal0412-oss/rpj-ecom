import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { todayISO } from '@/lib/attendance';
import { getShiftForEmployeeOnDate } from '@/lib/attendance-shifts';

export const dynamic = 'force-dynamic';

function requireAdmin(session: Awaited<ReturnType<typeof getSession>>) {
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('employees')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }
  return null;
}

function employeeCode(id: number) {
  return `RPJ-${String(id).padStart(4, '0')}`;
}

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  const denied = requireAdmin(session);
  if (denied) return denied;

  const db = getDb();
  const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(params.id) as any;
  if (!employee) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });

  const linkedUser = employee.linked_user_id
    ? db.prepare('SELECT id, name, username FROM users WHERE id = ?').get(employee.linked_user_id)
    : null;
  const currentShift = getShiftForEmployeeOnDate(db, employee.id, todayISO());

  return NextResponse.json({ ...employee, employee_code: employeeCode(employee.id), linked_user: linkedUser, current_shift: currentShift });
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  const denied = requireAdmin(session);
  if (denied) return denied;

  try {
    const body = await req.json();
    if (!body.full_name?.trim()) {
      return NextResponse.json({ error: 'Full name is required' }, { status: 400 });
    }

    const db = getDb();
    const existingEmployee = db.prepare('SELECT id FROM employees WHERE id = ?').get(params.id);
    if (!existingEmployee) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });

    if (body.linked_user_id) {
      const conflict = db.prepare('SELECT id FROM employees WHERE linked_user_id = ? AND id != ?').get(body.linked_user_id, params.id);
      if (conflict) return NextResponse.json({ error: 'That system user is already linked to another employee.' }, { status: 409 });
    }

    db.prepare(`
      UPDATE employees SET
        full_name=?, mobile_number=?, email=?, address=?, birthday=?, emergency_contact_name=?, emergency_contact_number=?,
        position=?, department=?, branch=?, date_hired=?, employment_type=?, employment_status=?,
        work_days=?, rest_day=?, attendance_enabled=?, linked_user_id=?,
        salary_type=?, basic_rate=?, allowance=?, ot_eligible=?
      WHERE id=?
    `).run(
      body.full_name.trim(), body.mobile_number || null, body.email || null, body.address || null,
      body.birthday || null, body.emergency_contact_name || null, body.emergency_contact_number || null,
      body.position || null, body.department || null, body.branch || null, body.date_hired || null,
      body.employment_type || 'Probationary', body.employment_status || 'Active',
      Array.isArray(body.work_days) ? body.work_days.join(',') : '1,2,3,4,5',
      body.rest_day ?? null, body.attendance_enabled === false ? 0 : 1, body.linked_user_id || null,
      body.salary_type || 'Monthly', Number(body.basic_rate) || 0, Number(body.allowance) || 0,
      body.ot_eligible === false ? 0 : 1,
      params.id
    );

    return NextResponse.json({ ok: true, employee_code: employeeCode(Number(params.id)) });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
