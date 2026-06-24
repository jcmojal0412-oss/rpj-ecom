import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyPassword, encodeSession, sessionCookieOptions } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { username, password } = await req.json();
    if (!username || !password) {
      return NextResponse.json({ error: 'Username and password required' }, { status: 400 });
    }

    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(username.toLowerCase()) as {
      id: number; name: string; username: string; password_hash: string;
      role: string; avatar_color: string;
    } | undefined;

    if (!user || !verifyPassword(password, user.password_hash)) {
      return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
    }

    const permissions = (db.prepare('SELECT module FROM user_permissions WHERE user_id=?').all(user.id) as { module: string }[])
      .map(r => r.module);

    const sessionUser: SessionUser = {
      id: user.id,
      name: user.name,
      username: user.username,
      role: user.role as 'owner' | 'staff',
      avatar_color: user.avatar_color,
      permissions,
    };

    const token = encodeSession(sessionUser);
    const res   = NextResponse.json({ ok: true, user: sessionUser });
    res.cookies.set(sessionCookieOptions(token));
    return res;
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
