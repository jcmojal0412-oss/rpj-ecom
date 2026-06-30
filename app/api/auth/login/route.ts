import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyPassword, encodeSession, sessionCookieOptions } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const MAX_ATTEMPTS  = 3;
const LOCKOUT_MINUTES = 15;

export async function POST(req: NextRequest) {
  try {
    const { username, password } = await req.json();
    if (!username || !password) {
      return NextResponse.json({ error: 'Username and password required' }, { status: 400 });
    }

    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(username.toLowerCase()) as {
      id: number; name: string; username: string; password_hash: string;
      role: string; avatar_color: string; failed_attempts: number; locked_until: string | null;
    } | undefined;

    // Account doesn't exist — generic error (don't reveal which part was wrong)
    if (!user) {
      return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
    }

    // Check if currently locked out
    if (user.locked_until) {
      const lockedUntil = new Date(user.locked_until + 'Z'); // treat as UTC
      if (lockedUntil > new Date()) {
        const minutesLeft = Math.ceil((lockedUntil.getTime() - Date.now()) / 60000);
        return NextResponse.json({
          error: `Too many failed attempts. Account locked. Try again in ${minutesLeft} minute${minutesLeft !== 1 ? 's' : ''}.`
        }, { status: 429 });
      }
      // Lock expired — reset
      db.prepare('UPDATE users SET failed_attempts=0, locked_until=NULL WHERE id=?').run(user.id);
      user.failed_attempts = 0;
    }

    if (!verifyPassword(password, user.password_hash)) {
      const attempts = (user.failed_attempts ?? 0) + 1;

      if (attempts >= MAX_ATTEMPTS) {
        const lockUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60000).toISOString().slice(0, 19);
        db.prepare('UPDATE users SET failed_attempts=?, locked_until=? WHERE id=?').run(attempts, lockUntil, user.id);
        return NextResponse.json({
          error: `Per-sign attempts exceeded. Account locked for ${LOCKOUT_MINUTES} minutes.`
        }, { status: 429 });
      }

      db.prepare('UPDATE users SET failed_attempts=? WHERE id=?').run(attempts, user.id);
      const remaining = MAX_ATTEMPTS - attempts;
      return NextResponse.json({
        error: `Invalid username or password. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`
      }, { status: 401 });
    }

    // Successful login — reset attempt counter
    db.prepare('UPDATE users SET failed_attempts=0, locked_until=NULL WHERE id=?').run(user.id);

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
