import { NextResponse } from 'next/server';
import { calendarRoute, idOf } from '@/lib/calendar-http';
import { duplicateEvent } from '@/lib/calendar-service';

export const POST = calendarRoute<{ id: string }>(async (_req, { db, caps, today }, { id }) => {
  const newId = duplicateEvent(db, caps, idOf(id), today);
  return NextResponse.json({ ok: true, id: newId }, { status: 201 });
});
