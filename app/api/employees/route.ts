import { NextRequest, NextResponse } from 'next/server';
import { getDb, runTransaction } from '@/lib/db';
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

export async function GET(req: NextRequest) {
  const session = await getSession();
  const denied = requireAdmin(session);
  if (denied) return denied;

  const db = getDb();
  const status = req.nextUrl.searchParams.get('status');
  const branch = req.nextUrl.searchParams.get('branch');
  const department = req.nextUrl.searchParams.get('department');
  const q = req.nextUrl.searchParams.get('q');

  let sql = 'SELECT * FROM employees WHERE 1=1';
  const params: any[] = [];
  if (status) { sql += ' AND employment_status = ?'; params.push(status); }
  if (branch) { sql += ' AND branch = ?'; params.push(branch); }
  if (department) { sql += ' AND department = ?'; params.push(department); }
  if (q) { sql += ' AND (full_name LIKE ? OR position LIKE ? OR department LIKE ?)'; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  sql += ' ORDER BY full_name ASC';

  const rows = db.prepare(sql).all(...params) as any[];
  const today = todayISO();
  const withCode = rows.map(r => ({
    ...r,
    employee_code: employeeCode(r.id),
    default_shift: getShiftForEmployeeOnDate(db, r.id, today),
  }));
  return NextResponse.json(withCode);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  const denied = requireAdmin(session);
  if (denied) return denied;

  try {
    const body = await req.json();
    if (!body.full_name?.trim()) {
      return NextResponse.json({ error: 'Full name is required' }, { status: 400 });
    }

    const db = getDb();

    if (body.linked_user_id) {
      const existing = db.prepare('SELECT id FROM employees WHERE linked_user_id = ?').get(body.linked_user_id);
      if (existing) return NextResponse.json({ error: 'That system user is already linked to another employee.' }, { status: 409 });
    }

    let newId = 0;
    runTransaction(() => {
      const info = db.prepare(`
        INSERT INTO employees (
          full_name, mobile_number, email, address, birthday, emergency_contact_name, emergency_contact_number,
          position, department, branch, date_hired, employment_type, employment_status,
          work_days, rest_day, attendance_enabled, linked_user_id,
          salary_type, basic_rate, allowance, ot_eligible
        ) VALUES (?,?,?,?,?,?,?, ?,?,?,?,?,?, ?,?,?,?, ?,?,?,?)
      `).run(
        body.full_name.trim(), body.mobile_number || null, body.email || null, body.address || null,
        body.birthday || null, body.emergency_contact_name || null, body.emergency_contact_number || null,
        body.position || null, body.department || null, body.branch || null, body.date_hired || null,
        body.employment_type || 'Probationary', body.employment_status || 'Active',
        Array.isArray(body.work_days) ? body.work_days.join(',') : '1,2,3,4,5',
        body.rest_day ?? null, body.attendance_enabled === false ? 0 : 1, body.linked_user_id || null,
        body.salary_type || 'Monthly', Number(body.basic_rate) || 0, Number(body.allowance) || 0,
        body.ot_eligible === false ? 0 : 1
      );
      newId = Number(info.lastInsertRowid);

      // Every employee needs a shift assignment for attendance calculations
      // to resolve — default to the first active shift template, or the
      // explicitly requested one.
      const shiftId = body.shift_id
        ? Number(body.shift_id)
        : (db.prepare('SELECT id FROM attendance_shifts WHERE active = 1 ORDER BY id ASC LIMIT 1').get() as { id: number } | undefined)?.id;
      if (shiftId) {
        db.prepare('INSERT INTO attendance_shift_assignments (employee_id, user_id, shift_id, effective_from, created_by) VALUES (?, ?, ?, ?, ?)')
          .run(newId, body.linked_user_id || -newId, shiftId, todayISO(), session!.id);
      }
    });

    return NextResponse.json({ id: newId, employee_code: employeeCode(newId) }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
