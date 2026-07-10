import nodemailer from 'nodemailer';

let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });
  }
  return transporter;
}

export async function sendEmail(to: string, subject: string, html: string) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    console.error('[email] GMAIL_USER / GMAIL_APP_PASSWORD not configured — skipping send');
    return { sent: false };
  }
  try {
    await getTransporter().sendMail({
      from: `SEDO Official <${process.env.GMAIL_USER}>`,
      to,
      subject,
      html,
    });
    return { sent: true };
  } catch (e) {
    console.error('[email] send failed:', e);
    return { sent: false, error: String(e) };
  }
}
