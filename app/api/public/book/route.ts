import { NextRequest, NextResponse } from 'next/server';
import { getDb, runTransaction } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const db = getDb();
    const { name, email, contact, date, time, notes } = await req.json();

    if (!name?.trim() || !email?.trim() || !date || !time) {
      return NextResponse.json({ error: 'name, email, date, and time are required' }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
      return NextResponse.json({ error: 'Invalid date/time format' }, { status: 400 });
    }

    const schedule = `${date} ${time}:00`;
    let bookingId: number | undefined;

    // Re-check the slot is still free at the moment of booking (race-condition guard
    // for two people booking the same slot at nearly the same time).
    runTransaction(() => {
      const clash = db.prepare(`
        SELECT id FROM partners WHERE schedule = ?
      `).get(schedule);
      if (clash) {
        throw new Error('SLOT_TAKEN');
      }
      const info = db.prepare(`
        INSERT INTO partners (name, contact, schedule, remarks, email, notes)
        VALUES (?, ?, ?, 'PENDING', ?, ?)
      `).run(name.trim(), contact?.trim() || null, schedule, email.trim(), notes?.trim() || null);
      bookingId = Number(info.lastInsertRowid);
    });

    return NextResponse.json({ id: bookingId, schedule }, { status: 201 });
  } catch (e: any) {
    if (e.message === 'SLOT_TAKEN') {
      return NextResponse.json({ error: 'That time slot was just booked by someone else. Please pick another.' }, { status: 409 });
    }
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
