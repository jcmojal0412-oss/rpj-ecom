import { NextRequest, NextResponse } from 'next/server';
import { getDb, runTransaction } from '@/lib/db';
import { sendEmail } from '@/lib/email';
import { discoveryCallEmailHtml } from '@/lib/email-templates';

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

    // Slots allow multiple bookings — no clash check against existing rows.
    runTransaction(() => {
      const info = db.prepare(`
        INSERT INTO partners (name, contact, schedule, remarks, email, notes)
        VALUES (?, ?, ?, 'PENDING', ?, ?)
      `).run(name.trim(), contact?.trim() || null, schedule, email.trim(), notes?.trim() || null);
      bookingId = Number(info.lastInsertRowid);
    });

    const zoomLink = (db.prepare("SELECT value FROM app_settings WHERE key='zoom_link'").get() as { value: string } | undefined)?.value ?? '';

    // Fire-and-forget — don't block the booking confirmation on email delivery.
    sendEmail(
      email.trim(),
      'Your SEDO Discovery Call is Confirmed',
      discoveryCallEmailHtml({
        name: name.trim(),
        date,
        time,
        zoomLink,
        badgeText: '&#9989; BOOKING CONFIRMED',
        headline: 'Your SEDO Discovery Call is Confirmed',
        subtext: "we're excited to show you how to start your online store.",
        activeStep: 'booking',
      })
    ).catch(() => {});

    return NextResponse.json({ id: bookingId, schedule, zoomLink }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
