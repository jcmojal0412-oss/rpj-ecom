import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner') return NextResponse.json({ error: 'Not authorized' }, { status: 403 });

  const id = Number(params.id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  try {
    const body = await req.json();
    const db = getDb();
    const existing = db.prepare('SELECT * FROM cc_reminders WHERE id = ?').get(id);
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const fields: string[] = [];
    const values: any[] = [];
    for (const key of ['title', 'category', 'remind_date', 'remind_time', 'recurrence', 'recurrence_day', 'status']) {
      if (key in body) { fields.push(`${key} = ?`); values.push(body[key]); }
    }
    if (!fields.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });

    values.push(id);
    db.prepare(`UPDATE cc_reminders SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner') return NextResponse.json({ error: 'Not authorized' }, { status: 403 });

  const id = Number(params.id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const db = getDb();
  db.prepare('DELETE FROM cc_reminders WHERE id = ?').run(id);
  return NextResponse.json({ ok: true });
}
