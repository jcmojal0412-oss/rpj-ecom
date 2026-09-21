import { NextResponse } from 'next/server';
import { calendarRoute } from '@/lib/calendar-http';
import { upcoming } from '@/lib/calendar-service';

// Today, this week, everything overdue, and the prioritised list for the CEO dashboard.
export const GET = calendarRoute(async (_req, { db, caps, today }) => NextResponse.json(upcoming(db, caps, today, 7)));
