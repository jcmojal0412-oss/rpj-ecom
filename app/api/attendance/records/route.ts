import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { computeDaySummary, isTodayFinalized, todayISO, type AttendanceEvent } from '@/lib/attendance';
import { loadGlobalBreakSettings, resolveAttendanceSettings } from '@/lib/attendance-shifts';

export const dynamic = 'force-dynamic';

function dateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  let cur = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur = new Date(cur.getTime() + 86_400_000);
  }
  return dates;
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('attendance')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const from = req.nextUrl.searchParams.get('from');
  const to = req.nextUrl.searchParams.get('to');
  const userIdParam = req.nextUrl.searchParams.get('user_id');
  if (!from || !to) return NextResponse.json({ error: 'from and to are required' }, { status: 400 });

  const db = getDb();
  // work_days is a global setting, independent of which shift an employee
  // is on — used only to pre-filter which dates in the range are business
  // days at all.
  const global = loadGlobalBreakSettings(db);

  const users = userIdParam
    ? db.prepare('SELECT id, name FROM users WHERE id = ? AND active = 1').all(Number(userIdParam))
    : db.prepare('SELECT id, name FROM users WHERE active = 1 ORDER BY name ASC').all();

  const userIds = (users as { id: number; name: string }[]).map(u => u.id);
  if (!userIds.length) return NextResponse.json([]);

  const eventsRaw = db.prepare(`
    SELECT id, user_id, event_date, event_type, event_time, superseded_by
    FROM attendance_events
    WHERE event_date BETWEEN ? AND ? AND user_id IN (${userIds.map(() => '?').join(',')}) AND is_test = 0
    ORDER BY event_time ASC
  `).all(from, to, ...userIds) as (AttendanceEvent & { user_id: number; event_date: string })[];

  const eventsByUserDate = new Map<string, AttendanceEvent[]>();
  for (const e of eventsRaw) {
    const key = `${e.user_id}|${e.event_date}`;
    if (!eventsByUserDate.has(key)) eventsByUserDate.set(key, []);
    eventsByUserDate.get(key)!.push(e);
  }

  const today = todayISO();
  const dates = dateRange(from, to).filter(d => global.work_days.includes(new Date(d + 'T00:00:00').getDay()));
  const rows: any[] = [];

  for (const u of users as { id: number; name: string }[]) {
    for (const date of dates) {
      // History-aware: resolves whichever shift this employee was actually
      // assigned to on THIS date, not their current shift — so a shift
      // change never rewrites how past dates are computed.
      const resolved = resolveAttendanceSettings(db, u.id, date);
      if (!resolved) continue; // no shift assignment covering this date — nothing to compute
      const { settings, shift } = resolved;

      const events = eventsByUserDate.get(`${u.id}|${date}`) ?? [];
      const isFinalized = date < today || (date === today && isTodayFinalized(settings));
      const summary = computeDaySummary(events, settings, isFinalized);
      rows.push({ user_id: u.id, name: u.name, date, shift_name: shift.name, ...summary });
    }
  }

  return NextResponse.json(rows);
}
