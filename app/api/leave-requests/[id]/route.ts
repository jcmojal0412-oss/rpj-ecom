import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Approve/reject only ever updates this request's own row — it never
// writes to attendance_events. A day covered by an approved leave is
// reclassified from Absent to On Leave purely by lib/attendance-exceptions.ts
// reading this table live, so there's nothing else to keep in sync.
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('leave_management')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const action: 'approve' | 'reject' = body.action;
    const remarks: string | null = body.remarks?.trim() || null;

    const db = getDb();
    const request = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(params.id) as { id: number; status: string } | undefined;
    if (!request) return NextResponse.json({ error: 'Leave request not found' }, { status: 404 });
    if (request.status !== 'pending') return NextResponse.json({ error: 'This request was already reviewed' }, { status: 409 });

    if (action !== 'approve' && action !== 'reject') {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    db.prepare(`
      UPDATE leave_requests SET status=?, remarks=?, reviewed_by=?, reviewed_at=datetime('now') WHERE id=?
    `).run(action === 'approve' ? 'approved' : 'rejected', remarks, session.id, params.id);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
