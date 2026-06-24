import { NextRequest, NextResponse } from 'next/server';
import { getDb, runTransaction } from '@/lib/db';
import { hashPassword, getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

async function ownerOnly() {
  const s = await getSession();
  return s?.role === 'owner' ? s : null;
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  if (!await ownerOnly()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const db = getDb();
  const { name, username, password, avatar_color, active, permissions } = await req.json();
  const id = Number(params.id);

  runTransaction(() => {
    if (password) {
      db.prepare('UPDATE users SET name=?,username=?,password_hash=?,avatar_color=?,active=? WHERE id=?')
        .run(name, username.toLowerCase(), hashPassword(password), avatar_color, active ? 1 : 0, id);
    } else {
      db.prepare('UPDATE users SET name=?,username=?,avatar_color=?,active=? WHERE id=?')
        .run(name, username.toLowerCase(), avatar_color, active ? 1 : 0, id);
    }
    if (Array.isArray(permissions)) {
      db.prepare('DELETE FROM user_permissions WHERE user_id=?').run(id);
      const ins = db.prepare('INSERT INTO user_permissions (user_id,module) VALUES (?,?)');
      for (const m of permissions) ins.run(id, m);
    }
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  if (!await ownerOnly()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const db = getDb();
  const id = Number(params.id);
  const user = db.prepare('SELECT role FROM users WHERE id=?').get(id) as { role: string } | undefined;
  if (user?.role === 'owner') return NextResponse.json({ error: 'Cannot delete owner account' }, { status: 400 });
  runTransaction(() => {
    db.prepare('DELETE FROM user_permissions WHERE user_id=?').run(id);
    db.prepare('DELETE FROM users WHERE id=?').run(id);
  });
  return NextResponse.json({ ok: true });
}
