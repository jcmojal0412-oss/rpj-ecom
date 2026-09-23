// Sends email via Resend's HTTPS API instead of raw SMTP — Railway blocks
// outbound SMTP (ports 465/587) at the platform level, but this is a normal
// HTTPS POST request, so it works without any network restrictions.
//
// `fromName` / `fromAddress` let one kind of email (e.g. payslips) show its own
// sender ("RPJ Corporation <payroll@rpjcorp.com>") without touching the ones
// already going out with RESEND_FROM_EMAIL. Any @rpjcorp.com address works, as
// Resend verifies the whole domain rather than each address.
export interface EmailAttachment { filename: string; content: Buffer; }

export async function sendEmail(to: string, subject: string, html: string, replyTo?: string, fromName?: string, fromAddress?: string, bcc?: string[], attachments?: EmailAttachment[]) {
  const apiKey = process.env.RESEND_API_KEY;
  const configured = process.env.RESEND_FROM_EMAIL || 'SEDO Official <onboarding@resend.dev>';
  const configuredAddress = (configured.match(/<([^>]+)>/)?.[1] ?? configured).trim();
  const address = fromAddress && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/.test(fromAddress) ? fromAddress.trim() : configuredAddress;
  const from = fromName || fromAddress ? `${(fromName ?? '').replace(/[<>"]/g, '').trim() || 'RPJ Corporation'} <${address}>` : configured;

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
      body: JSON.stringify({
        from, to, subject, html, ...(replyTo ? { reply_to: replyTo } : {}), ...(bcc?.length ? { bcc } : {}),
        ...(attachments?.length ? { attachments: attachments.map(a => ({ filename: a.filename, content: a.content.toString('base64') })) } : {}),
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('[email] send failed:', res.status, body);
      return { sent: false, error: `${res.status} ${body}` };
    }

    // Resend answers { id }. Callers that want to track delivery keep it.
    const json = await res.json().catch(() => null) as { id?: unknown } | null;
    return { sent: true, id: typeof json?.id === 'string' ? json.id : undefined };
  } catch (e) {
    console.error('[email] send failed:', e);
    return { sent: false, error: String(e) };
  }
}
