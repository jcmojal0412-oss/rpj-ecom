import { NextRequest, NextResponse } from 'next/server';
import { getDb, runTransaction } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface RangeRow {
  day_of_week: number;
  start_time: string;
  end_time: string;
  enabled: number;
}

export async function GET() {
  try {
    const db = getDb();
    const ranges = db.prepare(
      'SELECT day_of_week, start_time, end_time, enabled FROM booking_slots ORDER BY day_of_week, sort_order, start_time'
    ).all() as RangeRow[];
    const duration = db.prepare("SELECT value FROM app_settings WHERE key='booking_duration_minutes'").get() as { value: string } | undefined;
    const minNotice = db.prepare("SELECT value FROM app_settings WHERE key='booking_min_notice_hours'").get() as { value: string } | undefined;
    const zoomLink = db.prepare("SELECT value FROM app_settings WHERE key='zoom_link'").get() as { value: string } | undefined;
    return NextResponse.json({
      ranges,
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
    const { ranges, durationMinutes, minNoticeHours, zoomLink } = await req.json();

    runTransaction(() => {
      db.prepare('DELETE FROM booking_slots').run();
      const insert = db.prepare(
        'INSERT INTO booking_slots (day_of_week, start_time, end_time, enabled, sort_order) VALUES (?,?,?,?,?)'
      );
      (ranges as RangeRow[]).forEach((r, i) => {
        insert.run(r.day_of_week, r.start_time, r.end_time, r.enabled ? 1 : 0, i);
      });
      db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('booking_duration_minutes', ?)").run(String(durationMinutes ?? 60));
      db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('booking_min_notice_hours', ?)").run(String(minNoticeHours ?? 2));
      db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('zoom_link', ?)").run(zoomLink ?? '');
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
