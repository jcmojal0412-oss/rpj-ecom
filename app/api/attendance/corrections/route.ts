import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import type { EventType } from '@/lib/attendance';

export const dynamic = 'force-dynamic';

const VALID_TYPES: EventType[] = ['TIME_IN', 'COFFEE_OUT', 'COFFEE_IN', 'LUNCH_OUT', 'LUNCH_IN', 'TIME_OUT'];

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const selfOnly = req.nextUrl.searchParams.get('self') === '1';
  const isAdmin = !selfOnly && (session.role === 'owner' || session.permissions.includes('attendance'));
  const db = getDb();

  if (isAdmin) {
    const status = req.nextUrl.searchParams.get('status');
    const rows = status
      ? db.prepare(`
          SELECT c.*, u.name AS employee_name FROM attendance_corrections c
          JOIN users u ON u.id = c.user_id
          WHERE c.status = ? ORDER BY c.created_at DESC
        `).all(status)
      : db.prepare(`
          SELECT c.*, u.name AS employee_name FROM attendance_corrections c
          JOIN users u ON u.id = c.user_id
          ORDER BY c.created_at DESC
        `).all();
    return NextResponse.json(rows);
  }

  const rows = db.prepare('SELECT * FROM attendance_corrections WHERE user_id = ? ORDER BY created_at DESC').all(session.id);
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  try {
    const body = await req.json();
    const { event_date, original_event_id, requested_event_type, requested_time, reason } = body;

    if (!event_date || !requested_event_type || !requested_time || !reason?.trim()) {
      return NextResponse.json({ error: 'event_date, requested_event_type, requested_time, and reason are required' }, { status: 400 });
    }
    if (!VALID_TYPES.includes(requested_event_type)) {
      return NextResponse.json({ error: 'Invalid requested_event_type' }, { status: 400 });
    }

    const db = getDb();
    const info = db.prepare(`
      INSERT INTO attendance_corrections (user_id, event_date, original_event_id, requested_event_type, requested_time, reason)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(session.id, event_date, original_event_id || null, requested_event_type, requested_time, reason.trim());

    return NextResponse.json({ id: Number(info.lastInsertRowid) }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
