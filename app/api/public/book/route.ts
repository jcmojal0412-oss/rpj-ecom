import { NextRequest, NextResponse } from 'next/server';
import { getDb, runTransaction } from '@/lib/db';
import { sendEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';

function formatDateLabel(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-PH', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

function formatTimeLabel(time: string) {
  const [h, m] = time.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function confirmationEmailHtml(name: string, date: string, time: string, zoomLink: string) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1f2937;">
      <div style="text-align: center; padding: 24px 0;">
        <h1 style="font-size: 18px; margin: 0;">SEDO Discovery Call</h1>
      </div>
      <div style="background: #f9fafb; border-radius: 12px; padding: 24px;">
        <p style="margin: 0 0 12px;">Hi ${name},</p>
        <p style="margin: 0 0 16px;">Your discovery call is confirmed! Here are the details:</p>
        <p style="margin: 0 0 4px;"><strong>Date:</strong> ${formatDateLabel(date)}</p>
        <p style="margin: 0 0 16px;"><strong>Time:</strong> ${formatTimeLabel(time)} (Philippines Time, GMT+8)</p>
        ${zoomLink
          ? `<a href="${zoomLink}" style="display: inline-block; background: #f97316; color: #fff; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-weight: bold;">Join Zoom Meeting</a>`
          : `<p style="margin: 0; color: #6b7280;">We'll send the meeting link separately before the call.</p>`}
        <p style="margin: 20px 0 0; font-size: 13px; color: #6b7280;">See you then!</p>
      </div>
    </div>
  `;
}

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

    const zoomLink = (db.prepare("SELECT value FROM app_settings WHERE key='zoom_link'").get() as { value: string } | undefined)?.value ?? '';

    // Fire-and-forget — don't block the booking confirmation on email delivery.
    sendEmail(
      email.trim(),
      'Your SEDO Discovery Call is Confirmed',
      confirmationEmailHtml(name.trim(), date, time, zoomLink)
    ).catch(() => {});

    return NextResponse.json({ id: bookingId, schedule, zoomLink }, { status: 201 });
  } catch (e: any) {
    if (e.message === 'SLOT_TAKEN') {
      return NextResponse.json({ error: 'That time slot was just booked by someone else. Please pick another.' }, { status: 409 });
    }
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
