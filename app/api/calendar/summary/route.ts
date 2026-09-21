import { NextResponse } from 'next/server';
import { calendarRoute } from '@/lib/calendar-http';
import { CalendarError, monthSummary } from '@/lib/calendar-service';

// Scheduled money for one month — only from schedules this person may see.
export const GET = calendarRoute(async (req, { db, caps, today }) => {
  const month = req.nextUrl.searchParams.get('month') ?? today.slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new CalendarError('Choose a valid month.');
  return NextResponse.json({ ...monthSummary(db, caps, month, today), can_see_finance: caps.isOwner || caps.finance || caps.payroll });
});
