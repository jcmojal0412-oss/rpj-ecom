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
  const dateLabel = formatDateLabel(date);
  const timeLabel = formatTimeLabel(time);
  const logoUrl = 'https://rpjcorp.com/sedo-logo.png';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Your SEDO Discovery Call is Confirmed</title>
<style>
  @media only screen and (max-width: 600px) {
    .sedo-container { width: 100% !important; border-radius: 0 !important; }
    .sedo-px { padding-left: 24px !important; padding-right: 24px !important; }
    .sedo-learn-cell { display: block !important; width: 100% !important; padding-left: 0 !important; padding-right: 0 !important; }
    .sedo-progress-cell { display: block !important; width: 100% !important; margin-bottom: 12px; }
  }
</style>
</head>
<body style="margin:0; padding:0; background-color:#f4f6f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6f9; padding:32px 0;">
    <tr>
      <td align="center">
        <table role="presentation" class="sedo-container" width="600" cellpadding="0" cellspacing="0" style="width:600px; max-width:600px; background-color:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 4px 24px rgba(0,87,184,0.08);">

          <!-- Hero -->
          <tr>
            <td class="sedo-px" style="background-color:#0057B8; padding:40px 40px 32px; text-align:center;">
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px; background-color:#ffffff; border-radius:14px;"><tr><td style="padding:12px 20px;">
                <img src="${logoUrl}" width="140" alt="SEDO" style="display:block; max-width:140px; height:auto; border:0;" />
              </td></tr></table>
              <span style="display:inline-block; background-color:rgba(255,255,255,0.15); color:#ffffff; font-size:12px; font-weight:600; letter-spacing:0.5px; padding:6px 14px; border-radius:20px; margin-bottom:16px;">&#9989; BOOKING CONFIRMED</span>
              <h1 style="margin:16px 0 0; color:#ffffff; font-size:24px; line-height:1.35; font-weight:700;">Your SEDO Discovery Call is Confirmed</h1>
              <p style="margin:12px 0 0; color:#cfe0f7; font-size:15px;">Hi ${name}, we're excited to show you how to start your online store.</p>
            </td>
          </tr>

          <!-- Meeting info card -->
          <tr>
            <td class="sedo-px" style="padding:32px 40px 8px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc; border-radius:14px; border:1px solid #e7ecf3;">
                <tr>
                  <td style="padding:24px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td width="40" style="vertical-align:top; padding-bottom:16px;">
                          <div style="width:36px; height:36px; background-color:#e6f0fc; border-radius:10px; text-align:center; line-height:36px; font-size:16px;">&#128197;</div>
                        </td>
                        <td style="vertical-align:top; padding-left:12px; padding-bottom:16px;">
                          <div style="font-size:11px; color:#8a94a6; font-weight:600; letter-spacing:0.5px; text-transform:uppercase;">Date</div>
                          <div style="font-size:15px; color:#1f2937; font-weight:600; margin-top:2px;">${dateLabel}</div>
                        </td>
                      </tr>
                      <tr>
                        <td width="40" style="vertical-align:top; padding-bottom:16px;">
                          <div style="width:36px; height:36px; background-color:#e6f0fc; border-radius:10px; text-align:center; line-height:36px; font-size:16px;">&#128337;</div>
                        </td>
                        <td style="vertical-align:top; padding-left:12px; padding-bottom:16px;">
                          <div style="font-size:11px; color:#8a94a6; font-weight:600; letter-spacing:0.5px; text-transform:uppercase;">Time</div>
                          <div style="font-size:15px; color:#1f2937; font-weight:600; margin-top:2px;">${timeLabel} &nbsp;<span style="color:#8a94a6; font-weight:500;">(Philippines Time, GMT+8)</span></div>
                        </td>
                      </tr>
                      <tr>
                        <td width="40" style="vertical-align:top;">
                          <div style="width:36px; height:36px; background-color:#e6f0fc; border-radius:10px; text-align:center; line-height:36px; font-size:16px;">&#128187;</div>
                        </td>
                        <td style="vertical-align:top; padding-left:12px;">
                          <div style="font-size:11px; color:#8a94a6; font-weight:600; letter-spacing:0.5px; text-transform:uppercase;">Platform</div>
                          <div style="font-size:15px; color:#1f2937; font-weight:600; margin-top:2px;">Zoom Meeting</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td class="sedo-px" style="padding:24px 40px 8px; text-align:center;">
              ${zoomLink
                ? `<a href="${zoomLink}" style="display:inline-block; background-color:#0057B8; color:#ffffff; font-size:16px; font-weight:700; text-decoration:none; padding:16px 40px; border-radius:12px; box-shadow:0 6px 16px rgba(0,87,184,0.3);">Join Discovery Call</a>
                   <div style="margin-top:12px; font-size:12px; color:#8a94a6;">Save this link — you'll need it on ${dateLabel}</div>`
                : `<div style="display:inline-block; background-color:#eef2f7; color:#5b6472; font-size:14px; padding:14px 28px; border-radius:12px;">We'll send your Zoom link shortly before the call.</div>`
              }
            </td>
          </tr>

          <!-- What you'll learn -->
          <tr>
            <td class="sedo-px" style="padding:32px 40px 8px;">
              <h2 style="margin:0 0 16px; font-size:17px; color:#1f2937; font-weight:700;">What You'll Learn</h2>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td class="sedo-learn-cell" width="50%" style="vertical-align:top; padding:0 8px 12px 0;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc; border-radius:12px; border:1px solid #edf1f6;"><tr><td style="padding:16px;">
                      <div style="font-size:20px; margin-bottom:8px;">&#129513;</div>
                      <div style="font-size:13px; color:#333d4d; font-weight:600; line-height:1.4;">How the SEDO business model works</div>
                    </td></tr></table>
                  </td>
                  <td class="sedo-learn-cell" width="50%" style="vertical-align:top; padding:0 0 12px 8px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc; border-radius:12px; border:1px solid #edf1f6;"><tr><td style="padding:16px;">
                      <div style="font-size:20px; margin-bottom:8px;">&#128230;</div>
                      <div style="font-size:13px; color:#333d4d; font-weight:600; line-height:1.4;">How to start without inventory</div>
                    </td></tr></table>
                  </td>
                </tr>
                <tr>
                  <td class="sedo-learn-cell" width="50%" style="vertical-align:top; padding:0 8px 12px 0;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc; border-radius:12px; border:1px solid #edf1f6;"><tr><td style="padding:16px;">
                      <div style="font-size:20px; margin-bottom:8px;">&#128666;</div>
                      <div style="font-size:13px; color:#333d4d; font-weight:600; line-height:1.4;">Fulfillment process</div>
                    </td></tr></table>
                  </td>
                  <td class="sedo-learn-cell" width="50%" style="vertical-align:top; padding:0 0 12px 8px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc; border-radius:12px; border:1px solid #edf1f6;"><tr><td style="padding:16px;">
                      <div style="font-size:20px; margin-bottom:8px;">&#129309;</div>
                      <div style="font-size:13px; color:#333d4d; font-weight:600; line-height:1.4;">Partner support</div>
                    </td></tr></table>
                  </td>
                </tr>
                <tr>
                  <td class="sedo-learn-cell" width="50%" style="vertical-align:top; padding:0 8px 0 0;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc; border-radius:12px; border:1px solid #edf1f6;"><tr><td style="padding:16px;">
                      <div style="font-size:20px; margin-bottom:8px;">&#128640;</div>
                      <div style="font-size:13px; color:#333d4d; font-weight:600; line-height:1.4;">Next steps after joining</div>
                    </td></tr></table>
                  </td>
                  <td class="sedo-learn-cell" width="50%"></td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Before you join -->
          <tr>
            <td class="sedo-px" style="padding:24px 40px 8px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0f7ff; border-radius:14px; border:1px solid #dbe9fb;">
                <tr><td style="padding:20px 24px;">
                  <h2 style="margin:0 0 12px; font-size:15px; color:#0057B8; font-weight:700;">Before You Join</h2>
                  <div style="font-size:14px; color:#333d4d; line-height:2;">
                    <div>&#9989; &nbsp;Join 5 minutes early</div>
                    <div>&#9989; &nbsp;Stable internet connection</div>
                    <div>&#9989; &nbsp;Prepare your questions</div>
                  </div>
                </td></tr>
              </table>
            </td>
          </tr>

          <!-- Progress -->
          <tr>
            <td class="sedo-px" style="padding:32px 40px 8px;">
              <h2 style="margin:0 0 16px; font-size:17px; color:#1f2937; font-weight:700; text-align:center;">Your Journey</h2>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td class="sedo-progress-cell" width="33%" style="text-align:center; vertical-align:top;">
                    <div style="font-size:22px;">&#9989;</div>
                    <div style="font-size:12px; color:#0057B8; font-weight:700; margin-top:6px;">Booking Confirmed</div>
                  </td>
                  <td class="sedo-progress-cell" width="33%" style="text-align:center; vertical-align:top;">
                    <div style="font-size:22px;">&#8987;</div>
                    <div style="font-size:12px; color:#8a94a6; font-weight:700; margin-top:6px;">Discovery Call</div>
                  </td>
                  <td class="sedo-progress-cell" width="33%" style="text-align:center; vertical-align:top;">
                    <div style="font-size:22px;">&#128640;</div>
                    <div style="font-size:12px; color:#8a94a6; font-weight:700; margin-top:6px;">Launch Your Business</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td class="sedo-px" style="padding:32px 40px 40px; text-align:center; border-top:1px solid #eef1f6;">
              <p style="margin:24px 0 4px; font-size:13px; color:#8a94a6;">See you at the call — we're excited to help you start your online store!</p>
              <p style="margin:0; font-size:12px; color:#b0b8c4;">SEDO — Build Your Online Store in 24 Hours</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
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
