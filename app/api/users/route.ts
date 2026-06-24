import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { hashPassword, getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const db = getDb();
  const users = db.prepare('SELECT id,name,username,role,avatar_color,active,created_at FROM users ORDER BY role DESC, name').all();
  const withPerms = users.map((u: any) => {
    const perms = (db.prepare('SELECT module FROM user_permissions WHERE user_id=?').all(u.id) as { module: string }[]).map(r => r.module);
    return { ...u, permissions: perms };
  });
  return NextResponse.json(withPerms);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const db = getDb();
  const { name, username, password, role, avatar_color, permissions } = await req.json();

  if (!name || !username || !password) {
    return NextResponse.json({ error: 'Name, username, and password are required' }, { status: 400 });
  }

  try {
    const info = db.prepare(
      'INSERT INTO users (name,username,password_hash,role,avatar_color) VALUES (?,?,?,?,?)'
    ).run(name, username.toLowerCase(), hashPassword(password), role ?? 'staff', avatar_color ?? 'blue');

    const uid = Number(info.lastInsertRowid);
    if (Array.isArray(permissions)) {
      const insertPerm = db.prepare('INSERT OR IGNORE INTO user_permissions (user_id,module) VALUES (?,?)');
      for (const m of permissions) insertPerm.run(uid, m);
    }
    return NextResponse.json({ id: uid }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
