import { NextResponse } from 'next/server';
import { calendarRoute } from '@/lib/calendar-http';
import { CalendarError, createEvent, listEvents, type EventInput } from '@/lib/calendar-service';
import { isISODate } from '@/lib/calendar';

const num = (v: string | null) => (v && Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);

// GET /api/calendar/events?from=&to=&q=&business_unit_id=&category=&status=&assigned_to=&financial_only=1&meetings_only=1&overdue_only=1
export const GET = calendarRoute(async (req, { db, caps, today }) => {
  const q = req.nextUrl.searchParams;
  const from = q.get('from') ?? '', to = q.get('to') ?? '';
  if (!isISODate(from) || !isISODate(to)) throw new CalendarError('Choose a valid date range.');
  if (to < from) throw new CalendarError('The end of the range is before its start.');
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  if (days > 400) throw new CalendarError('Choose a range of at most 13 months.');
  const events = listEvents(db, caps, {
    from, to, q: q.get('q') ?? '', business_unit_id: num(q.get('business_unit_id')), category: q.get('category') || null, status: q.get('status') || null,
    assigned_to: num(q.get('assigned_to')), financial_only: q.get('financial_only') === '1', meetings_only: q.get('meetings_only') === '1', overdue_only: q.get('overdue_only') === '1',
  }, today);
  return NextResponse.json({ events });
});

export const POST = calendarRoute(async (req, { db, caps, today }) => {
  let body: EventInput;
  try { body = await req.json(); } catch { throw new CalendarError('Invalid request.'); }
  const id = createEvent(db, caps, body, today);
  return NextResponse.json({ ok: true, id }, { status: 201 });
});
