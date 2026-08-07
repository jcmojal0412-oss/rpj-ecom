import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { loadGlobalBreakSettings } from '@/lib/attendance-shifts';

export const dynamic = 'force-dynamic';

// work_start/work_end/grace_period_minutes are resolved per-employee from
// their assigned shift (see the Shifts tab), and work_days is now a
// per-employee field (see the Employees page). This route only ever
// reads/writes the remaining truly-global settings: breaks, OT threshold,
// selfie requirement.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const db = getDb();
  return NextResponse.json(loadGlobalBreakSettings(db));
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('attendance')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const rows: [string, string][] = [
      ['attendance_lunch_break_minutes', String(body.lunch_break_minutes)],
      ['attendance_coffee_break_minutes', String(body.coffee_break_minutes)],
      ['attendance_coffee_breaks_allowed', String(body.coffee_breaks_allowed)],
      ['attendance_lunch_break_paid', body.lunch_break_paid ? '1' : '0'],
      ['attendance_coffee_break_paid', body.coffee_break_paid ? '1' : '0'],
      ['attendance_min_minutes_before_ot', String(body.min_minutes_before_ot)],
      ['attendance_selfie_required', body.selfie_required ? '1' : '0'],
    ];

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
