import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('attendance')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const db = getDb();
  const status = req.nextUrl.searchParams.get('status');
  const rows = status
    ? db.prepare(`
        SELECT o.*, u.name AS employee_name FROM attendance_ot_requests o
        JOIN users u ON u.id = o.user_id
        WHERE o.status = ? ORDER BY o.event_date DESC
      `).all(status)
    : db.prepare(`
        SELECT o.*, u.name AS employee_name FROM attendance_ot_requests o
        JOIN users u ON u.id = o.user_id
        ORDER BY o.event_date DESC
      `).all();

  return NextResponse.json(rows);
}
