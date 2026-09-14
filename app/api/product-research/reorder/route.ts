import { NextRequest, NextResponse } from 'next/server';
import { getDb, runTransaction } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface ReorderItem { id: number; status: string; sort_order: number; }

// Persists a drag-and-drop move from KanbanBoard.tsx in one shot: the
// dragged card's new column (if it changed) plus the full, renumbered
// sort_order sequence for every card in whichever column(s) were touched
// (the source column loses a card and needs its remaining cards
// renumbered; the destination column gains one). Sent as a batch rather
// than one PUT per card so a multi-card column reorder is one round trip
// and one transaction.
export async function PUT(req: NextRequest) {
  try {
    const db = getDb();
    const { items } = await req.json() as { items: ReorderItem[] };
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'items array is required' }, { status: 400 });
    }

    const update = db.prepare('UPDATE product_research SET status=?, sort_order=? WHERE id=?');
    runTransaction(() => {
      for (const it of items) update.run(it.status, it.sort_order, it.id);
    });

    return NextResponse.json({ ok: true, updated: items.length });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
