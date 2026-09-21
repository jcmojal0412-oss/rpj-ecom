import { NextResponse } from 'next/server';
import { calendarRoute, idOf } from '@/lib/calendar-http';
import { CalendarError, deleteEvent, getEventDetail, updateEvent, type EventInput } from '@/lib/calendar-service';

type P = { id: string };
const scopeOf = (v: unknown) => (v === 'future' || v === 'all' ? v : 'this') as 'this' | 'future' | 'all';

export const GET = calendarRoute<P>(async (_req, { db, caps, today }, { id }) => NextResponse.json(getEventDetail(db, caps, idOf(id), today)));

export const PUT = calendarRoute<P>(async (req, { db, caps, today }, { id }) => {
  let body: EventInput & { scope?: string };
  try { body = await req.json(); } catch { throw new CalendarError('Invalid request.'); }
  updateEvent(db, caps, idOf(id), body, scopeOf(body.scope), today);
  return NextResponse.json({ ok: true });
});

// DELETE /api/calendar/events/12?scope=this|future|all
export const DELETE = calendarRoute<P>(async (req, { db, caps, today }, { id }) => {
  const r = deleteEvent(db, caps, idOf(id), scopeOf(req.nextUrl.searchParams.get('scope')), today);
  return NextResponse.json({ ok: true, ...r });
});
