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
    const avail = db.prepare('SELECT * FROM booking_availability WHERE day_of_week=?').get(dayOfWeek) as
      { start_time: string; end_time: string; enabled: number } | undefined;

    if (!avail || !avail.enabled) {
      return NextResponse.json({ slots: [] });
    }

    const durationMin = parseInt(getSetting(db, 'booking_duration_minutes', '60'), 10);
    const minNoticeHours = parseFloat(getSetting(db, 'booking_min_notice_hours', '2'));

    const [startH, startM] = avail.start_time.split(':').map(Number);
    const [endH, endM] = avail.end_time.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    // Existing bookings that day (stored as "YYYY-MM-DD HH:MM" or ISO in partners.schedule)
    const booked = db.prepare(`
      SELECT schedule FROM partners
      WHERE schedule IS NOT NULL AND substr(schedule, 1, 10) = ?
    `).all(date) as { schedule: string }[];
    const bookedMinutes = new Set(
      booked.map(b => {
        const t = b.schedule.slice(11, 16); // "HH:MM"
        const [h, m] = t.split(':').map(Number);
        return h * 60 + m;
      })
    );

    const now = nowPH();
    const isToday = date === `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
    const nowMinutesToday = now.getUTCHours() * 60 + now.getUTCMinutes();
    const minNoticeMinutes = minNoticeHours * 60;

    const slots: string[] = [];
    for (let m = startMinutes; m + durationMin <= endMinutes; m += durationMin) {
      if (bookedMinutes.has(m)) continue;
      if (isToday && m < nowMinutesToday + minNoticeMinutes) continue;
      const h = Math.floor(m / 60);
      const mm = m % 60;
      slots.push(`${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`);
    }

    return NextResponse.json({ slots, durationMinutes: durationMin });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
