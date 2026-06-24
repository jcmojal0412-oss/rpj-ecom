import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getDb();
    const { name, color, sort_order } = await req.json();
    if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

    db.prepare(
      'UPDATE research_statuses SET name=?, color=?, sort_order=? WHERE id=?'
    ).run(name.trim(), color ?? 'gray', sort_order ?? 0, params.id);

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getDb();

    // Check how many products use this status
    const status = db.prepare('SELECT name FROM research_statuses WHERE id=?').get(params.id) as { name: string } | undefined;
    if (!status) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const count = (db.prepare('SELECT COUNT(*) as c FROM product_research WHERE status=?').get(status.name) as { c: number }).c;
    if (count > 0) {
      return NextResponse.json(
        { error: `Hindi ma-delete — may ${count} product${count !== 1 ? 's' : ''} pa na naka-assign sa status na ito.` },
        { status: 400 }
      );
    }

    db.prepare('DELETE FROM research_statuses WHERE id=?').run(params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
