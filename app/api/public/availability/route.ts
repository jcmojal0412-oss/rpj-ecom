import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

function getSetting(db: ReturnType<typeof getDb>, key: string, fallback: string): string {
  const row = db.prepare('SELECT value FROM app_settings WHERE key=?').get(key) as { value: string } | undefined;
  return row?.value ?? fallback;
}

// Philippine "now" (UTC+8, no DST) regardless of server's actual timezone.
function nowPH(): Date {
  return new Date(Date.now() + 8 * 60 * 60 * 1000);
}

export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const date = req.nextUrl.searchParams.get('date');
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'date=YYYY-MM-DD is required' }, { status: 400 });
    }

    const dayOfWeek = new Date(date + 'T00:00:00Z').getUTCDay();
    const ranges = db.prepare(
      'SELECT start_time, end_time FROM booking_slots WHERE day_of_week=? AND enabled=1 ORDER BY sort_order, start_time'
    ).all(dayOfWeek) as { start_time: string; end_time: string }[];

    if (ranges.length === 0) {
      return NextResponse.json({ slots: [] });
    }

    const durationMin = parseInt(getSetting(db, 'booking_duration_minutes', '60'), 10);
    const minNoticeHours = parseFloat(getSetting(db, 'booking_min_notice_hours', '2'));

    const now = nowPH();
    const isToday = date === `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
    const nowMinutesToday = now.getUTCHours() * 60 + now.getUTCMinutes();
    const minNoticeMinutes = minNoticeHours * 60;

    // Slots allow multiple bookings, so a slot stays listed as available
    // regardless of how many people have already booked it. A day can now
    // have several ranges (e.g. 9am-12pm and 2pm-5pm) — union their slots.
    const slotSet = new Set<string>();
    for (const r of ranges) {
      const [startH, startM] = r.start_time.split(':').map(Number);
      const [endH, endM] = r.end_time.split(':').map(Number);
      const startMinutes = startH * 60 + startM;
      const endMinutes = endH * 60 + endM;
      for (let m = startMinutes; m + durationMin <= endMinutes; m += durationMin) {
        if (isToday && m < nowMinutesToday + minNoticeMinutes) continue;
        const h = Math.floor(m / 60);
        const mm = m % 60;
        slotSet.add(`${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`);
      }
    }

    const slots = Array.from(slotSet).sort();
    return NextResponse.json({ slots, durationMinutes: durationMin });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
