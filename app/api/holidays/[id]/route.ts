import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

function requireAdmin(session: Awaited<ReturnType<typeof getSession>>) {
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('leave_management')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }
  return null;
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  const denied = requireAdmin(session);
  if (denied) return denied;

  try {
    const body = await req.json();
    if (!body.name?.trim() || !body.date) {
      return NextResponse.json({ error: 'Name and date are required' }, { status: 400 });
    }

    const db = getDb();
    const existing = db.prepare('SELECT id FROM holidays WHERE id = ?').get(params.id);
    if (!existing) return NextResponse.json({ error: 'Holiday not found' }, { status: 404 });

    const conflict = db.prepare('SELECT id FROM holidays WHERE date = ? AND id != ?').get(body.date, params.id);
    if (conflict) return NextResponse.json({ error: 'A holiday is already configured for that date' }, { status: 409 });

    db.prepare(`
      UPDATE holidays SET name=?, date=?, holiday_type=?, is_working=? WHERE id=?
    `).run(body.name.trim(), body.date, body.holiday_type || 'Regular Holiday', body.is_working ? 1 : 0, params.id);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  const denied = requireAdmin(session);
  if (denied) return denied;

  const db = getDb();
  db.prepare('DELETE FROM holidays WHERE id = ?').run(params.id);
  return NextResponse.json({ ok: true });
}
