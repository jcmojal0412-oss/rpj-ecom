import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Public endpoint — returns staff names/avatars for the login quick-access grid
export async function GET() {
  try {
    const db = getDb();
    const rows = db.prepare(
      "SELECT id, name, username, avatar_color FROM users WHERE role='staff' AND active=1 ORDER BY name"
    ).all();
    return NextResponse.json(rows);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
