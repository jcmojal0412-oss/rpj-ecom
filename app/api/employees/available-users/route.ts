import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// All system users, flagged with whether they're already linked to an
// employee (and to which one) — lets the Employee form's "link to system
// user" picker show/exclude appropriately, while still allowing the
// employee's OWN currently-linked user to remain selectable when editing.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('employees')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const db = getDb();
  const users = db.prepare('SELECT id, name, username FROM users ORDER BY name ASC').all() as { id: number; name: string; username: string }[];
  const links = db.prepare('SELECT id AS employee_id, linked_user_id, full_name FROM employees WHERE linked_user_id IS NOT NULL').all() as
    { employee_id: number; linked_user_id: number; full_name: string }[];
  const linkMap = new Map(links.map(l => [l.linked_user_id, l]));

  const result = users.map(u => ({
    ...u,
    linked_employee_id: linkMap.get(u.id)?.employee_id ?? null,
    linked_employee_name: linkMap.get(u.id)?.full_name ?? null,
  }));

  return NextResponse.json(result);
}
