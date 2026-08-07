import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// GET is open to any logged-in user (My Attendance may want to show
// upcoming holidays); only mutations are admin-gated.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const db = getDb();
  const rows = db.prepare('SELECT * FROM holidays ORDER BY date ASC').all();
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('leave_management')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  try {
    const body = await req.json();
    if (!body.name?.trim() || !body.date) {
      return NextResponse.json({ error: 'Name and date are required' }, { status: 400 });
    }

    const db = getDb();
    const existing = db.prepare('SELECT id FROM holidays WHERE date = ?').get(body.date);
    if (existing) return NextResponse.json({ error: 'A holiday is already configured for that date' }, { status: 409 });

    const info = db.prepare(`
      INSERT INTO holidays (name, date, holiday_type, is_working) VALUES (?, ?, ?, ?)
    `).run(body.name.trim(), body.date, body.holiday_type || 'Regular Holiday', body.is_working ? 1 : 0);

    return NextResponse.json({ id: Number(info.lastInsertRowid) }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
