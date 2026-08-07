import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Cancels/removes an exception record — that date range reverts to normal
// attendance evaluation (holiday/leave/absent as it would otherwise compute).
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('leave_management')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const db = getDb();
  db.prepare('DELETE FROM attendance_exceptions WHERE id = ?').run(params.id);
  return NextResponse.json({ ok: true });
}
