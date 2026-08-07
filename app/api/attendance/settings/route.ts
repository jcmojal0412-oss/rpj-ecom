import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { parseAttendanceSettings, settingsToRows } from '@/lib/attendance';

export const dynamic = 'force-dynamic';

const ATTENDANCE_KEYS = [
  'attendance_work_start', 'attendance_work_end', 'attendance_grace_period_minutes',
  'attendance_lunch_break_minutes', 'attendance_coffee_break_minutes', 'attendance_coffee_breaks_allowed',
  'attendance_lunch_break_paid', 'attendance_coffee_break_paid', 'attendance_min_minutes_before_ot',
  'attendance_selfie_required', 'attendance_work_days',
];

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const db = getDb();
  const rows = db.prepare(
    `SELECT key, value FROM app_settings WHERE key IN (${ATTENDANCE_KEYS.map(() => '?').join(',')})`
  ).all(...ATTENDANCE_KEYS) as { key: string; value: string }[];

  return NextResponse.json(parseAttendanceSettings(rows));
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('attendance')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const rows = settingsToRows(body);
    const db = getDb();
    const upsert = db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    const tx = db.transaction((pairs: [string, string][]) => {
      for (const [k, v] of pairs) upsert.run(k, v);
    });
    tx(rows);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
