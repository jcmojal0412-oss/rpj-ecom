import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Distinct Branch/Department values across ALL employees (not just the
// current filtered page) — powers the masterlist's filter dropdowns so the
// options list stays complete regardless of what's currently filtered in.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('employees')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const db = getDb();
  const branches = (db.prepare(`SELECT DISTINCT branch FROM employees WHERE branch IS NOT NULL AND branch != '' ORDER BY branch ASC`).all() as { branch: string }[]).map(r => r.branch);
  const departments = (db.prepare(`SELECT DISTINCT department FROM employees WHERE department IS NOT NULL AND department != '' ORDER BY department ASC`).all() as { department: string }[]).map(r => r.department);

  return NextResponse.json({ branches, departments });
}
