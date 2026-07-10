import { getDb } from './db';
import { sendEmail } from './email';
import { discoveryCallEmailHtml } from './email-templates';

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
      const html = discoveryCallEmailHtml({
        name: b.name,
        date,
        time: timeHHMM,
        zoomLink,
        badgeText: '&#8987; REMINDER: TOMORROW',
        headline: 'Your SEDO Discovery Call is Tomorrow!',
        subtext: "your discovery call is coming up tomorrow — we can't wait to meet you.",
        activeStep: 'call',
      });
      const result = await sendEmail(b.email!, 'Reminder: Your SEDO Discovery Call is Tomorrow', html);
      if (result.sent) {
        db.prepare('UPDATE partners SET reminder_24h_sent=1 WHERE id=?').run(b.id);
        sent24h++;
      }
    }

    if (!b.reminder_1h_sent && diffHours <= 1 && diffHours > 0.5) {
      const html = discoveryCallEmailHtml({
        name: b.name,
        date,
        time: timeHHMM,
        zoomLink,
        badgeText: '&#128308; STARTING SOON',
        headline: 'Your SEDO Discovery Call Starts in 1 Hour!',
        subtext: 'your discovery call starts soon — grab your questions and get ready to join.',
        activeStep: 'call',
      });
      const result = await sendEmail(b.email!, 'Reminder: Your SEDO Discovery Call Starts Soon', html);
      if (result.sent) {
        db.prepare('UPDATE partners SET reminder_1h_sent=1 WHERE id=?').run(b.id);
        sent1h++;
      }
    }
  }

  return { sent24h, sent1h };
}
