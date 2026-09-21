import { NextResponse } from 'next/server';
import { calendarRoute } from '@/lib/calendar-http';
import { CalendarError } from '@/lib/calendar-service';
import { loadDemoData, removeDemoData } from '@/lib/calendar-demo';

// Owner only: { action: 'load' | 'remove' } — sample schedules, clearly flagged, easy to remove.
export const POST = calendarRoute(async (req, { db, caps, today }) => {
  if (!caps.isOwner) throw new CalendarError('Only the Owner can load or remove sample data.', 403);
  let body: { action?: string };
  try { body = await req.json(); } catch { throw new CalendarError('Invalid request.'); }
  if (body.action === 'load') return NextResponse.json({ ok: true, created: loadDemoData(db, caps, today) });
  if (body.action === 'remove') return NextResponse.json({ ok: true, removed: removeDemoData(db) });
  throw new CalendarError('Unknown action.');
}, { maintain: false });
