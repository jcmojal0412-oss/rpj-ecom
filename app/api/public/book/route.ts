import { NextRequest, NextResponse } from 'next/server';
import { getDb, runTransaction } from '@/lib/db';
import { sendEmail } from '@/lib/email';
import { sendSms } from '@/lib/sms';
import { discoveryCallEmailHtml, bookingNotificationEmailHtml, formatDateLabel, formatTimeLabel } from '@/lib/email-templates';
import { createCalendarEvent } from '@/lib/google-calendar';

export const dynamic = 'force-dynamic';

const NOTIFICATION_EMAIL = 'sedo.officialph@gmail.com';

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
    if (contact?.trim() && !/^(?:\+63|0)9\d{9}$/.test(contact.trim().replace(/[\s-]/g, ''))) {
      return NextResponse.json({ error: 'Please enter a valid PH mobile number (e.g. 09171234567).' }, { status: 400 });
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
    const durationMinutes = parseInt(
      (db.prepare("SELECT value FROM app_settings WHERE key='booking_duration_minutes'").get() as { value: string } | undefined)?.value ?? '60',
      10
    );

    // Fire-and-forget — don't block the booking confirmation on email/calendar delivery.
    // reply_to points at a real inbox — bookings@rpjcorp.com (the "from"
    // address) has no mail hosting behind it, so replies there would bounce.
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
      }),
      NOTIFICATION_EMAIL
    ).catch(() => {});

    sendEmail(
      NOTIFICATION_EMAIL,
      `New Discovery Call Booking — ${name.trim()}`,
      bookingNotificationEmailHtml({
        name: name.trim(),
        email: email.trim(),
        contact: contact?.trim() || '',
        date,
        time,
        notes: notes?.trim() || '',
      }),
      email.trim()
    ).catch(() => {});

    if (contact?.trim()) {
      // No raw link in the SMS body — Smart (and sometimes Globe) silently
      // drops messages containing URLs from senders without a link
      // whitelist, even though the gateway reports them as "Sent".
      const smsMessage = `SEDO: Hi ${name.trim()}! Your Discovery Call is confirmed for ${formatDateLabel(date)} at ${formatTimeLabel(time)} (GMT+8). Check email or FB page for Zoom link.`;
      sendSms(contact.trim(), smsMessage).catch(() => {});
    }

    createCalendarEvent({
      date,
      time,
      durationMinutes,
      summary: `SEDO Discovery Call — ${name.trim()}`,
      description: [
        `Customer: ${name.trim()}`,
        `Email: ${email.trim()}`,
        contact?.trim() ? `Mobile: ${contact.trim()}` : null,
        notes?.trim() ? `Notes: ${notes.trim()}` : null,
        zoomLink ? `Zoom: ${zoomLink}` : null,
      ].filter(Boolean).join('\n'),
      zoomLink,
    }).catch(() => {});

    return NextResponse.json({ id: bookingId, schedule, zoomLink }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
