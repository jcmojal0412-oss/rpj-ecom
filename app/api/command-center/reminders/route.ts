import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner') return NextResponse.json({ error: 'Not authorized' }, { status: 403 });

  const db = getDb();
  const rows = db.prepare(`SELECT * FROM cc_reminders WHERE status = 'active' ORDER BY remind_date IS NULL, remind_date ASC, remind_time IS NULL, remind_time ASC`).all();
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner') return NextResponse.json({ error: 'Not authorized' }, { status: 403 });

  try {
    const body = await req.json();
    if (!body.title?.trim()) return NextResponse.json({ error: 'Title is required' }, { status: 400 });

    const db = getDb();
    const info = db.prepare(`
      INSERT INTO cc_reminders (title, category, remind_date, remind_time, recurrence, recurrence_day)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      body.title.trim(),
      body.category?.trim() || null,
      body.remind_date || null,
      body.remind_time || null,
      body.recurrence || 'once',
      body.recurrence_day || null,
    );

    return NextResponse.json({ id: Number(info.lastInsertRowid) }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
