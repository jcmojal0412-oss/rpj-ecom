// Sends SMS via Semaphore's REST API (semaphore.co) — a PH-focused SMS
// gateway, cheaper and simpler for local mobile numbers than international
// providers. Mirrors lib/email.ts's fetch-based, no-SDK approach.
export async function sendSms(number: string, message: string) {
  const apiKey = process.env.SEMAPHORE_API_KEY;
  const senderName = process.env.SEMAPHORE_SENDER_NAME; // optional — needs Semaphore approval

  if (!apiKey) {
    console.error('[sms] SEMAPHORE_API_KEY not configured — skipping send');
    return { sent: false };
  }

  const cleanNumber = number.replace(/[\s-]/g, '');
  if (!cleanNumber) {
    return { sent: false, error: 'No phone number provided' };
  }

  try {
    const params = new URLSearchParams({
      apikey: apiKey,
      number: cleanNumber,
      message,
    });
    if (senderName) params.set('sendername', senderName);

    const res = await fetch('https://api.semaphore.co/api/v4/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('[sms] send failed:', res.status, body);
      if (body.includes('No active sender name found')) {
        return { sent: false, error: 'SMS sending is not active yet — your Semaphore sender name is still pending approval.' };
      }
      return { sent: false, error: `${res.status} ${body}` };
    }

    return { sent: true };
  } catch (e) {
    console.error('[sms] send failed:', e);
    return { sent: false, error: String(e) };
  }
}
