import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import {
  parseAttendanceSettings, computeDaySummary, isConfiguredWorkDay, isTodayFinalized, todayISO,
  type AttendanceEvent,
} from '@/lib/attendance';

export const dynamic = 'force-dynamic';

const ATTENDANCE_KEYS = [
  'attendance_work_start', 'attendance_work_end', 'attendance_grace_period_minutes',
  'attendance_lunch_break_minutes', 'attendance_coffee_break_minutes', 'attendance_coffee_breaks_allowed',
  'attendance_lunch_break_paid', 'attendance_coffee_break_paid', 'attendance_min_minutes_before_ot',
  'attendance_selfie_required', 'attendance_work_days',
];

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
  const settingsRows = db.prepare(
    `SELECT key, value FROM app_settings WHERE key IN (${ATTENDANCE_KEYS.map(() => '?').join(',')})`
  ).all(...ATTENDANCE_KEYS) as { key: string; value: string }[];
  const settings = parseAttendanceSettings(settingsRows);

  const users = userIdParam
    ? db.prepare('SELECT id, name FROM users WHERE id = ? AND active = 1').all(Number(userIdParam))
    : db.prepare('SELECT id, name FROM users WHERE active = 1 ORDER BY name ASC').all();

  const userIds = (users as { id: number; name: string }[]).map(u => u.id);
  if (!userIds.length) return NextResponse.json([]);

  const eventsRaw = db.prepare(`
    SELECT id, user_id, event_date, event_type, event_time, superseded_by
    FROM attendance_events
    WHERE event_date BETWEEN ? AND ? AND user_id IN (${userIds.map(() => '?').join(',')})
    ORDER BY event_time ASC
  `).all(from, to, ...userIds) as (AttendanceEvent & { user_id: number; event_date: string })[];

  const eventsByUserDate = new Map<string, AttendanceEvent[]>();
  for (const e of eventsRaw) {
    const key = `${e.user_id}|${e.event_date}`;
    if (!eventsByUserDate.has(key)) eventsByUserDate.set(key, []);
    eventsByUserDate.get(key)!.push(e);
  }

  const today = todayISO();
  const dates = dateRange(from, to).filter(d => isConfiguredWorkDay(d, settings));
  const rows: any[] = [];

  for (const u of users as { id: number; name: string }[]) {
    for (const date of dates) {
      const events = eventsByUserDate.get(`${u.id}|${date}`) ?? [];
      const isFinalized = date < today || (date === today && isTodayFinalized(settings));
      const summary = computeDaySummary(events, settings, isFinalized);
      rows.push({ user_id: u.id, name: u.name, date, ...summary });
    }
  }

  return NextResponse.json(rows);
}
