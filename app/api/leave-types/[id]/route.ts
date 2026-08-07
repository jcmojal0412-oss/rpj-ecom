import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('leave_management')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  try {
    const body = await req.json();
    if (!body.name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

    const db = getDb();
    const existing = db.prepare('SELECT id FROM leave_types WHERE id = ?').get(params.id);
    if (!existing) return NextResponse.json({ error: 'Leave type not found' }, { status: 404 });

    db.prepare(`
      UPDATE leave_types SET name=?, paid=?, active=?, annual_credits=? WHERE id=?
    `).run(
      body.name.trim(),
      body.paid === false ? 0 : 1,
      body.active === false ? 0 : 1,
      body.annual_credits !== undefined && body.annual_credits !== null && body.annual_credits !== '' ? Number(body.annual_credits) : null,
      params.id
    );

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
