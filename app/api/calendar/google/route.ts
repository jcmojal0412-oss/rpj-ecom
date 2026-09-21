import { NextResponse } from 'next/server';
import { calendarRoute } from '@/lib/calendar-http';
import { CalendarError } from '@/lib/calendar-service';
import { googleStatus, reconcileGoogle, setSyncSettings } from '@/lib/calendar-google';

// Google Calendar sync settings — Owner only, because the connection is the company's Google account.
export const GET = calendarRoute(async (_req, { db, caps }) => {
  if (!caps.isOwner) throw new CalendarError('Only the Owner can manage Google Calendar sync.', 403);
  return NextResponse.json(googleStatus(db));
}, { maintain: false });

// { enabled?: boolean, include_details?: boolean }
export const PUT = calendarRoute(async (req, { db, caps }) => {
  if (!caps.isOwner) throw new CalendarError('Only the Owner can manage Google Calendar sync.', 403);
  let body: { enabled?: unknown; include_details?: unknown };
  try { body = await req.json(); } catch { throw new CalendarError('Invalid request.'); }
  if (body.enabled === true && !googleStatus(db).connected) throw new CalendarError('Connect Google Calendar first.', 409);
  setSyncSettings(db, {
    ...(typeof body.enabled === 'boolean' ? { enabled: body.enabled } : {}),
    ...(typeof body.include_details === 'boolean' ? { include_details: body.include_details } : {}),
  });
  return NextResponse.json(googleStatus(db));
}, { maintain: false });

// { action: 'sync_now' } — runs a pass right away and reports what happened.
export const POST = calendarRoute(async (req, { db, caps, today }) => {
  if (!caps.isOwner) throw new CalendarError('Only the Owner can manage Google Calendar sync.', 403);
  let body: { action?: string };
  try { body = await req.json(); } catch { throw new CalendarError('Invalid request.'); }
  if (body.action !== 'sync_now') throw new CalendarError('Unknown action.');
  const result = await reconcileGoogle(db, today, { force: true });
  return NextResponse.json({ result, status: googleStatus(db) });
}, { maintain: false });
