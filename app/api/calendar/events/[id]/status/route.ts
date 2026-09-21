import { NextResponse } from 'next/server';
import { calendarRoute, idOf } from '@/lib/calendar-http';
import { CalendarError, cancelEvent, completeEvent } from '@/lib/calendar-service';

// { action: 'cancel' | 'restore' | 'complete' | 'reopen', reason? }
export const POST = calendarRoute<{ id: string }>(async (req, { db, caps, today }, { id }) => {
  let body: { action?: string; reason?: string };
  try { body = await req.json(); } catch { throw new CalendarError('Invalid request.'); }
  const eventId = idOf(id);
  if (body.action === 'cancel') cancelEvent(db, caps, eventId, true, (body.reason ?? '').trim().slice(0, 300) || null, today);
  else if (body.action === 'restore') cancelEvent(db, caps, eventId, false, null, today);
  else if (body.action === 'complete') completeEvent(db, caps, eventId, true);
  else if (body.action === 'reopen') completeEvent(db, caps, eventId, false);
  else throw new CalendarError('Unknown action.');
  return NextResponse.json({ ok: true });
});
