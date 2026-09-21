import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { todayISO } from '@/lib/utils';
import { CalendarError, capsOf, runMaintenance, touchCalendar, type Caps } from '@/lib/calendar-service';

export const dynamic = 'force-dynamic';

export interface Ctx { db: ReturnType<typeof getDb>; caps: Caps; today: string; session: { id: number; role: string; permissions: string[]; name: string } }

// Wraps a calendar route: signs the caller in, works out what they may do, runs the
// overdue / reminder upkeep, and turns a CalendarError into a plain JSON message.
// (The middleware already limits /api/calendar to people with the Calendar permission.)
export function calendarRoute<P = Record<string, string>>(handler: (req: NextRequest, ctx: Ctx, params: P) => Promise<Response> | Response, opts: { maintain?: boolean } = { maintain: true }) {
  return async (req: NextRequest, { params }: { params: P }) => {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    if (session.role !== 'owner' && !session.permissions.includes('calendar')) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    try {
      const db = getDb();
      const today = todayISO();
      if (opts.maintain !== false) runMaintenance(db, today);
      const res = await handler(req, { db, caps: capsOf(session), today, session: session as Ctx['session'] }, params);
      // After any change, let the next read re-run the overdue / reminder upkeep straight away.
      if (req.method !== 'GET') touchCalendar();
      return res;
    } catch (e) {
      if (e instanceof CalendarError) return NextResponse.json({ error: e.message }, { status: e.status });
      console.error('[calendar]', e);
      return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
    }
  };
}

export const idOf = (v: string) => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw new CalendarError('Schedule not found.', 404); return n; };
