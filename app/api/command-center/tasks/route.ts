import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { todayISO } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner') return NextResponse.json({ error: 'Not authorized' }, { status: 403 });

  const db = getDb();
  const today = todayISO();
  const when = req.nextUrl.searchParams.get('when');

  // Local-calendar-safe date math: build the Date from Y/M/D parts (not by
  // parsing the "YYYY-MM-DD" string, which Date treats as UTC midnight and
  // can drift a day depending on server timezone), then read parts back the
  // same way — same pattern as app/api/dashboard/cogs-out/route.ts.
  const [ty, tm, td] = today.split('-').map(Number);
  const pad = (n: number) => String(n).padStart(2, '0');
  const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  let rows;
  if (when === 'today') {
    rows = db.prepare(`SELECT * FROM cc_tasks WHERE due_date = ? ORDER BY due_time IS NULL, due_time ASC`).all(today);
  } else if (when === 'tomorrow') {
    const d = new Date(ty, tm - 1, td + 1);
    rows = db.prepare(`SELECT * FROM cc_tasks WHERE due_date = ? ORDER BY due_time IS NULL, due_time ASC`).all(iso(d));
  } else if (when === 'week') {
    const d = new Date(ty, tm - 1, td + 6);
    rows = db.prepare(`SELECT * FROM cc_tasks WHERE due_date BETWEEN ? AND ? ORDER BY due_date ASC, due_time IS NULL, due_time ASC`).all(today, iso(d));
  } else if (when === 'overdue') {
    rows = db.prepare(`SELECT * FROM cc_tasks WHERE due_date < ? AND status NOT IN ('Completed','Cancelled') ORDER BY due_date ASC`).all(today);
  } else if (when === 'completed') {
    rows = db.prepare(`SELECT * FROM cc_tasks WHERE status = 'Completed' ORDER BY completed_at DESC`).all();
  } else {
    rows = db.prepare(`SELECT * FROM cc_tasks WHERE status != 'Cancelled' ORDER BY due_date IS NULL, due_date ASC, due_time IS NULL, due_time ASC`).all();
  }

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
      INSERT INTO cc_tasks (title, description, category, due_date, due_time, priority, status, source, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      body.title.trim(),
      body.description?.trim() || null,
      body.category?.trim() || null,
      body.due_date || null,
      body.due_time || null,
      body.priority || 'Normal',
      body.status || 'To Do',
      body.source === 'voice' ? 'voice' : 'typed',
      body.notes?.trim() || null,
    );

    return NextResponse.json({ id: Number(info.lastInsertRowid) }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
