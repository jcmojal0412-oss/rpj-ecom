import { getDb } from './db';
import { sendEmail } from './email';

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

function reminderEmailHtml(name: string, date: string, time: string, zoomLink: string, headline: string) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1f2937;">
      <div style="text-align: center; padding: 24px 0;">
        <h1 style="font-size: 18px; margin: 0;">SEDO Discovery Call</h1>
      </div>
      <div style="background: #f9fafb; border-radius: 12px; padding: 24px;">
        <p style="margin: 0 0 12px; font-weight: bold; color: #f97316;">${headline}</p>
        <p style="margin: 0 0 12px;">Hi ${name},</p>
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

interface Booking {
  id: number;
  name: string;
  email: string | null;
  schedule: string; // "YYYY-MM-DD HH:MM:SS", PH-local naive
  reminder_24h_sent: number;
  reminder_1h_sent: number;
}

// Checks all upcoming bookings and sends the 24h-before / 1h-before reminder
// emails whose window has arrived. Safe to call repeatedly — each reminder is
// only ever sent once per booking (tracked via reminder_*_sent columns).
export async function checkAndSendReminders(): Promise<{ sent24h: number; sent1h: number }> {
  const db = getDb();
  const zoomLink = (db.prepare("SELECT value FROM app_settings WHERE key='zoom_link'").get() as { value: string } | undefined)?.value ?? '';

  const upcoming = db.prepare(`
    SELECT id, name, email, schedule, reminder_24h_sent, reminder_1h_sent
    FROM partners
    WHERE schedule IS NOT NULL AND email IS NOT NULL AND email != ''
      AND (reminder_24h_sent = 0 OR reminder_1h_sent = 0)
  `).all() as Booking[];

  const now = Date.now();
  let sent24h = 0, sent1h = 0;

  for (const b of upcoming) {
    // schedule has been written in a few different formats over time
    // ("YYYY-MM-DD HH:MM:SS", "...T HH:MM" with no seconds, etc.) —
    // normalize before parsing so one bad row can't crash the whole batch.
    const normalized = b.schedule.trim().replace('T', ' ');
    const [date, timeRaw] = normalized.split(' ');
    if (!date || !timeRaw) continue;
    const timeHHMM = timeRaw.slice(0, 5);
    const timeHHMMSS = timeHHMM.length === 5 ? `${timeHHMM}:00` : timeRaw;

    // Interpret as GMT+8 explicitly so the diff is correct regardless of
    // the server's actual timezone.
    const meetingMs = new Date(`${date}T${timeHHMMSS}+08:00`).getTime();
    if (isNaN(meetingMs)) continue;
    const diffHours = (meetingMs - now) / 3_600_000;

    if (!b.reminder_24h_sent && diffHours <= 24 && diffHours > 23) {
      const html = reminderEmailHtml(b.name, date, timeHHMM, zoomLink, "Reminder: your call is tomorrow!");
      const result = await sendEmail(b.email!, 'Reminder: Your SEDO Discovery Call is Tomorrow', html);
      if (result.sent) {
        db.prepare('UPDATE partners SET reminder_24h_sent=1 WHERE id=?').run(b.id);
        sent24h++;
      }
    }

    if (!b.reminder_1h_sent && diffHours <= 1 && diffHours > 0.5) {
      const html = reminderEmailHtml(b.name, date, timeHHMM, zoomLink, "Reminder: your call starts in 1 hour!");
      const result = await sendEmail(b.email!, 'Reminder: Your SEDO Discovery Call Starts Soon', html);
      if (result.sent) {
        db.prepare('UPDATE partners SET reminder_1h_sent=1 WHERE id=?').run(b.id);
        sent1h++;
      }
    }
  }

  return { sent24h, sent1h };
}
