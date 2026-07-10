// Sends email via Resend's HTTPS API instead of raw SMTP — Railway blocks
// outbound SMTP (ports 465/587) at the platform level, but this is a normal
// HTTPS POST request, so it works without any network restrictions.
export async function sendEmail(to: string, subject: string, html: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL || 'SEDO Official <onboarding@resend.dev>';

  if (!apiKey) {
    console.error('[email] RESEND_API_KEY not configured — skipping send');
    return { sent: false };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to, subject, html }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('[email] send failed:', res.status, body);
      return { sent: false, error: `${res.status} ${body}` };
    }

    return { sent: true };
  } catch (e) {
    console.error('[email] send failed:', e);
    return { sent: false, error: String(e) };
  }
}
