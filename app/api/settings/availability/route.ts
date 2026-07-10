import { NextRequest, NextResponse } from 'next/server';
import { getDb, runTransaction } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    const days = db.prepare('SELECT * FROM booking_availability ORDER BY day_of_week').all();
    const duration = db.prepare("SELECT value FROM app_settings WHERE key='booking_duration_minutes'").get() as { value: string } | undefined;
    const minNotice = db.prepare("SELECT value FROM app_settings WHERE key='booking_min_notice_hours'").get() as { value: string } | undefined;
    const zoomLink = db.prepare("SELECT value FROM app_settings WHERE key='zoom_link'").get() as { value: string } | undefined;
    return NextResponse.json({
      days,
      durationMinutes: parseInt(duration?.value ?? '60', 10),
      minNoticeHours: parseFloat(minNotice?.value ?? '2'),
      zoomLink: zoomLink?.value ?? '',
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const db = getDb();
    const { days, durationMinutes, minNoticeHours, zoomLink } = await req.json();

    runTransaction(() => {
      const upd = db.prepare('UPDATE booking_availability SET start_time=?, end_time=?, enabled=? WHERE day_of_week=?');
      for (const d of days as { day_of_week: number; start_time: string; end_time: string; enabled: number }[]) {
        upd.run(d.start_time, d.end_time, d.enabled ? 1 : 0, d.day_of_week);
      }
      db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('booking_duration_minutes', ?)").run(String(durationMinutes ?? 60));
      db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('booking_min_notice_hours', ?)").run(String(minNoticeHours ?? 2));
      db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('zoom_link', ?)").run(zoomLink ?? '');
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
