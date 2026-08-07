import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

function isAdmin(session: NonNullable<Awaited<ReturnType<typeof getSession>>>) {
  return session.role === 'owner' || session.permissions.includes('leave_management');
}

// GET is open to any logged-in user (not just admins) — every employee
// needs the active leave-type list to populate their own leave request
// form. Pass ?all=1 (admin only) to include inactive types for management.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const db = getDb();
  const includeInactive = req.nextUrl.searchParams.get('all') === '1' && isAdmin(session);
  const rows = includeInactive
    ? db.prepare('SELECT * FROM leave_types ORDER BY name ASC').all()
    : db.prepare('SELECT * FROM leave_types WHERE active = 1 ORDER BY name ASC').all();

  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!isAdmin(session)) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });

  try {
    const body = await req.json();
    if (!body.name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

    const db = getDb();
    const info = db.prepare(`
      INSERT INTO leave_types (name, paid, active, annual_credits) VALUES (?, ?, ?, ?)
    `).run(
      body.name.trim(),
      body.paid === false ? 0 : 1,
      body.active === false ? 0 : 1,
      body.annual_credits !== undefined && body.annual_credits !== null && body.annual_credits !== '' ? Number(body.annual_credits) : null
    );

    return NextResponse.json({ id: Number(info.lastInsertRowid) }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
