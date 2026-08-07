import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

function requireAdmin(session: Awaited<ReturnType<typeof getSession>>) {
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('attendance')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }
  return null;
}

export async function GET() {
  const session = await getSession();
  const denied = requireAdmin(session);
  if (denied) return denied;

  const db = getDb();
  const shifts = db.prepare('SELECT * FROM attendance_shifts ORDER BY start_time ASC').all();
  return NextResponse.json(shifts);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  const denied = requireAdmin(session);
  if (denied) return denied;

  try {
    const { name, start_time, end_time, grace_period_minutes } = await req.json();
    if (!name?.trim() || !/^\d{2}:\d{2}$/.test(start_time) || !/^\d{2}:\d{2}$/.test(end_time)) {
      return NextResponse.json({ error: 'name, start_time (HH:MM), and end_time (HH:MM) are required' }, { status: 400 });
    }

    const db = getDb();
    const info = db.prepare(`
      INSERT INTO attendance_shifts (name, start_time, end_time, grace_period_minutes, active)
      VALUES (?, ?, ?, ?, 1)
    `).run(name.trim(), start_time, end_time, Number(grace_period_minutes) || 15);

    return NextResponse.json({ id: Number(info.lastInsertRowid) }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
