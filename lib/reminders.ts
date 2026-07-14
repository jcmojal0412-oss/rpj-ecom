import { getDb } from './db';
import { sendEmail } from './email';
import { sendSms } from './sms';
import { discoveryCallEmailHtml, formatDateLabel, formatTimeLabel } from './email-templates';

// bookings@rpjcorp.com (the "from" address) has no mail hosting behind it —
// replies there would bounce. Point Reply-To at a real inbox instead.
const REPLY_TO_EMAIL = 'sedo.officialph@gmail.com';

interface Booking {
  id: number;
  name: string;
  email: string | null;
  contact: string | null;
  schedule: string; // "YYYY-MM-DD HH:MM:SS", PH-local naive
  reminder_24h_sent: number;
  reminder_1h_sent: number;
  sms_24h_sent: number;
  sms_1h_sent: number;
}

// Checks all upcoming bookings and sends the 24h-before / 1h-before reminder
// emails and SMS whose window has arrived. Safe to call repeatedly — each
// reminder is only ever sent once per booking (tracked via *_sent columns).
export async function checkAndSendReminders(): Promise<{ sent24h: number; sent1h: number; sms24h: number; sms1h: number }> {
  const db = getDb();
  const zoomLink = (db.prepare("SELECT value FROM app_settings WHERE key='zoom_link'").get() as { value: string } | undefined)?.value ?? '';

  const upcoming = db.prepare(`
    SELECT id, name, email, contact, schedule, reminder_24h_sent, reminder_1h_sent, sms_24h_sent, sms_1h_sent
    FROM partners
    WHERE schedule IS NOT NULL
      AND (reminder_24h_sent = 0 OR reminder_1h_sent = 0 OR sms_24h_sent = 0 OR sms_1h_sent = 0)
  `).all() as Booking[];

  const now = Date.now();
  let sent24h = 0, sent1h = 0, sms24h = 0, sms1h = 0;

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

    const in24hWindow = diffHours <= 24 && diffHours > 23;
    const in1hWindow = diffHours <= 1 && diffHours > 0.5;
    if (!in24hWindow && !in1hWindow) continue;

    const hasEmail = !!b.email;
    const hasContact = !!b.contact;

    if (in24hWindow) {
      if (!b.reminder_24h_sent && hasEmail) {
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
        const result = await sendEmail(b.email!, 'Reminder: Your SEDO Discovery Call is Tomorrow', html, REPLY_TO_EMAIL);
        if (result.sent) {
          db.prepare('UPDATE partners SET reminder_24h_sent=1 WHERE id=?').run(b.id);
          sent24h++;
        }
      }
      if (!b.sms_24h_sent && hasContact) {
        // No raw link — Smart (and sometimes Globe) silently drops SMS
        // containing URLs from senders without a link whitelist.
        const message = `SEDO: Hi ${b.name}! Reminder: your Discovery Call is tomorrow, ${formatDateLabel(date)} at ${formatTimeLabel(timeHHMM)} (GMT+8). Check your email for the Zoom link.`;
        const result = await sendSms(b.contact!, message);
        if (result.sent) {
          db.prepare('UPDATE partners SET sms_24h_sent=1 WHERE id=?').run(b.id);
          sms24h++;
        }
      }
    }

    if (in1hWindow) {
      if (!b.reminder_1h_sent && hasEmail) {
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
        const result = await sendEmail(b.email!, 'Reminder: Your SEDO Discovery Call Starts Soon', html, REPLY_TO_EMAIL);
        if (result.sent) {
          db.prepare('UPDATE partners SET reminder_1h_sent=1 WHERE id=?').run(b.id);
          sent1h++;
        }
      }
      if (!b.sms_1h_sent && hasContact) {
        // No raw link — Smart (and sometimes Globe) silently drops SMS
        // containing URLs from senders without a link whitelist.
        const message = `SEDO: Hi ${b.name}! Your Discovery Call starts in 1 hour, ${formatTimeLabel(timeHHMM)} (GMT+8). Check your email for the Zoom link.`;
        const result = await sendSms(b.contact!, message);
        if (result.sent) {
          db.prepare('UPDATE partners SET sms_1h_sent=1 WHERE id=?').run(b.id);
          sms1h++;
        }
      }
    }
  }

  return { sent24h, sent1h, sms24h, sms1h };
}
