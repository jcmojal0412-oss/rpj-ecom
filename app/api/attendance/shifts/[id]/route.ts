import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// No DELETE — deactivating (active=0) is the only removal path, since
// historical attendance_shift_assignments rows may still reference this
// shift's id and must keep resolving correctly for old dates. Deactivating
// only hides it from the "assign a new shift" picker going forward.
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('attendance')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { name, start_time, end_time, grace_period_minutes, active } = body;

    if (!name?.trim() || !/^\d{2}:\d{2}$/.test(start_time) || !/^\d{2}:\d{2}$/.test(end_time)) {
      return NextResponse.json({ error: 'name, start_time (HH:MM), and end_time (HH:MM) are required' }, { status: 400 });
    }

    const db = getDb();
    db.prepare(`
      UPDATE attendance_shifts SET name=?, start_time=?, end_time=?, grace_period_minutes=?, active=?
      WHERE id=?
    `).run(name.trim(), start_time, end_time, Number(grace_period_minutes) || 15, active ? 1 : 0, params.id);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
