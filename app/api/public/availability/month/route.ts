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

    const slotRows = db.prepare(
      'SELECT day_of_week, start_time, end_time FROM booking_slots WHERE enabled=1'
    ).all() as { day_of_week: number; start_time: string; end_time: string }[];
    const rangesByDow = new Map<number, { start_time: string; end_time: string }[]>();
    for (const r of slotRows) {
      if (!rangesByDow.has(r.day_of_week)) rangesByDow.set(r.day_of_week, []);
      rangesByDow.get(r.day_of_week)!.push(r);
    }

    const durationMin = parseInt(getSetting(db, 'booking_duration_minutes', '60'), 10);
    const minNoticeHours = parseFloat(getSetting(db, 'booking_min_notice_hours', '2'));
    const minNoticeMinutes = minNoticeHours * 60;

    const now = nowPH();
    const todayStr = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
    const nowMinutesToday = now.getUTCHours() * 60 + now.getUTCMinutes();

    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const availableDays: number[] = [];

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (dateStr < todayStr) continue; // past date

      const dow = new Date(dateStr + 'T00:00:00Z').getUTCDay();
      const ranges = rangesByDow.get(dow);
      if (!ranges || ranges.length === 0) continue;

      const isToday = dateStr === todayStr;

      // Slots allow multiple bookings, so a day is available as long as it
      // has configured hours — no need to check existing bookings. A day can
      // have several ranges — a match in any range makes the day available.
      let hasSlot = false;
      for (const r of ranges) {
        const [startH, startM] = r.start_time.split(':').map(Number);
        const [endH, endM] = r.end_time.split(':').map(Number);
        const startMinutes = startH * 60 + startM;
        const endMinutes = endH * 60 + endM;
        for (let m = startMinutes; m + durationMin <= endMinutes; m += durationMin) {
          if (isToday && m < nowMinutesToday + minNoticeMinutes) continue;
          hasSlot = true;
          break;
        }
        if (hasSlot) break;
      }
      if (hasSlot) availableDays.push(day);
    }

    return NextResponse.json({ availableDays });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
