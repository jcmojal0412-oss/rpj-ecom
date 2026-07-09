import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

function getSetting(db: ReturnType<typeof getDb>, key: string, fallback: string): string {
  const row = db.prepare('SELECT value FROM app_settings WHERE key=?').get(key) as { value: string } | undefined;
  return row?.value ?? fallback;
}

function nowPH(): Date {
  return new Date(Date.now() + 8 * 60 * 60 * 1000);
}

// Returns which days in a given month have at least one open slot.
export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const year  = parseInt(req.nextUrl.searchParams.get('year')  ?? '', 10);
    const month = parseInt(req.nextUrl.searchParams.get('month') ?? '', 10); // 1-12
    if (!year || !month) {
      return NextResponse.json({ error: 'year and month are required' }, { status: 400 });
    }

    const availRows = db.prepare('SELECT * FROM booking_availability').all() as
      { day_of_week: number; start_time: string; end_time: string; enabled: number }[];
    const availByDow = new Map(availRows.map(r => [r.day_of_week, r]));

    const durationMin = parseInt(getSetting(db, 'booking_duration_minutes', '60'), 10);
    const minNoticeHours = parseFloat(getSetting(db, 'booking_min_notice_hours', '2'));
    const minNoticeMinutes = minNoticeHours * 60;

    const now = nowPH();
    const todayStr = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
    const nowMinutesToday = now.getUTCHours() * 60 + now.getUTCMinutes();

    // All bookings in this month, grouped by date -> set of booked start-minutes
    const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
    const booked = db.prepare(`
      SELECT schedule FROM partners WHERE schedule IS NOT NULL AND substr(schedule, 1, 7) = ?
    `).all(monthPrefix) as { schedule: string }[];
    const bookedByDate = new Map<string, Set<number>>();
    for (const b of booked) {
      const d = b.schedule.slice(0, 10);
      const t = b.schedule.slice(11, 16);
      const [h, m] = t.split(':').map(Number);
      if (!bookedByDate.has(d)) bookedByDate.set(d, new Set());
      bookedByDate.get(d)!.add(h * 60 + m);
    }

    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const availableDays: number[] = [];

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (dateStr < todayStr) continue; // past date

      const dow = new Date(dateStr + 'T00:00:00Z').getUTCDay();
      const avail = availByDow.get(dow);
      if (!avail || !avail.enabled) continue;

      const [startH, startM] = avail.start_time.split(':').map(Number);
      const [endH, endM] = avail.end_time.split(':').map(Number);
      const startMinutes = startH * 60 + startM;
      const endMinutes = endH * 60 + endM;
      const bookedSet = bookedByDate.get(dateStr) ?? new Set<number>();
      const isToday = dateStr === todayStr;

      let hasSlot = false;
      for (let m = startMinutes; m + durationMin <= endMinutes; m += durationMin) {
        if (bookedSet.has(m)) continue;
        if (isToday && m < nowMinutesToday + minNoticeMinutes) continue;
        hasSlot = true;
        break;
      }
      if (hasSlot) availableDays.push(day);
    }

    return NextResponse.json({ availableDays });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
