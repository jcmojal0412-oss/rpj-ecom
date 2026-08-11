import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner') return NextResponse.json({ error: 'Not authorized' }, { status: 403 });

  const db = getDb();
  const rows = db.prepare(`SELECT * FROM cc_follow_ups WHERE status = 'waiting' ORDER BY follow_up_date IS NULL, follow_up_date ASC`).all();
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
      INSERT INTO cc_follow_ups (title, status_note, category, follow_up_date)
      VALUES (?, ?, ?, ?)
    `).run(
      body.title.trim(),
      body.status_note?.trim() || null,
      body.category?.trim() || null,
      body.follow_up_date || null,
    );

    return NextResponse.json({ id: Number(info.lastInsertRowid) }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
