import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { hashPassword, getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Owner-only, single-purpose password reset — deliberately separate from
// PUT /api/users/[id] (which requires resending name/username/avatar_color/
// active every time) so a caller that only has a new password, like the
// Employee 201 "Set/Reset Password" action, can't accidentally clobber
// those other fields with missing values.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { password } = await req.json();
  if (!password || String(password).length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 });
  }

  const db = getDb();
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(params.id);
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), params.id);
  return NextResponse.json({ ok: true });
}
