import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface PartnerRow {
  id: number;
  name: string;
  contact: string | null;
  email: string | null;
  schedule: string;
  remarks: string | null;
}

interface ScheduleGroup {
  schedule: string;
  count: number;
  attendees: { id: number; name: string; contact: string | null; email: string | null; remarks: string | null }[];
}

function nowPH(): Date {
  return new Date(Date.now() + 8 * 60 * 60 * 1000);
}

export async function GET() {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT id, name, contact, email, schedule, remarks
      FROM partners
      WHERE schedule IS NOT NULL AND schedule != ''
      ORDER BY schedule ASC
    `).all() as PartnerRow[];

    const groupsBySchedule = new Map<string, PartnerRow[]>();
    for (const r of rows) {
      if (!groupsBySchedule.has(r.schedule)) groupsBySchedule.set(r.schedule, []);
      groupsBySchedule.get(r.schedule)!.push(r);
    }

    const groups: ScheduleGroup[] = Array.from(groupsBySchedule.entries())
      .map(([schedule, attendees]) => ({
        schedule,
        count: attendees.length,
        attendees: attendees.map(a => ({ id: a.id, name: a.name, contact: a.contact, email: a.email, remarks: a.remarks })),
      }))
      .sort((a, b) => a.schedule.localeCompare(b.schedule));

    const now = nowPH();
    const todayStr = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;

    return NextResponse.json({
      today: groups.filter(g => g.schedule.slice(0, 10) === todayStr),
      upcoming: groups.filter(g => g.schedule.slice(0, 10) > todayStr),
      past: groups.filter(g => g.schedule.slice(0, 10) < todayStr).reverse(),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
