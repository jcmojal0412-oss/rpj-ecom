import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Minimal active-employee list for admin attendance filters/dropdowns
// (Daily Records, Test Mode). Only Active + Attendance Enabled employees —
// deliberately NOT the users table, since a system login no longer implies
// attendance tracking.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('attendance')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const db = getDb();
  const rows = db.prepare(`
    SELECT id, full_name AS name FROM employees
    WHERE employment_status = 'Active' AND attendance_enabled = 1
    ORDER BY full_name ASC
  `).all();
  return NextResponse.json(rows);
}
