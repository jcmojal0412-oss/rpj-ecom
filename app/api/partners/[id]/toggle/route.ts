import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getDb();
    const partner = db.prepare('SELECT active FROM partners WHERE id=?').get(params.id) as { active: number } | undefined;
    if (!partner) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const newActive = partner.active ? 0 : 1;
    db.prepare('UPDATE partners SET active=? WHERE id=?').run(newActive, params.id);
    return NextResponse.json({ active: newActive });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
