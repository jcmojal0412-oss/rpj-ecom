import { NextResponse } from 'next/server';
import { calendarRoute } from '@/lib/calendar-http';
import { CalendarError, markNotificationsRead, notificationsFor } from '@/lib/calendar-service';

export const GET = calendarRoute(async (_req, { db, caps, today }) => NextResponse.json(notificationsFor(db, caps, today)));

// { ids: [1,2] } or { all: true }
export const POST = calendarRoute(async (req, { db, caps }) => {
  let body: { ids?: number[]; all?: boolean };
  try { body = await req.json(); } catch { throw new CalendarError('Invalid request.'); }
  if (body.all) markNotificationsRead(db, caps, 'all');
  else if (Array.isArray(body.ids)) markNotificationsRead(db, caps, body.ids.map(Number).filter(n => Number.isInteger(n) && n > 0));
  else throw new CalendarError('Nothing to mark.');
  return NextResponse.json({ ok: true });
}, { maintain: false });
