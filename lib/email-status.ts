import crypto from 'crypto';
import type Database from 'better-sqlite3';

// Delivery tracking for payslip emails. "sent" only means Resend accepted the
// email; the rest come back from Resend afterwards (webhook, or a manual check).
export type EmailStatus = 'sent' | 'delayed' | 'delivered' | 'bounced' | 'complained' | 'failed';

// A later event never walks the status backwards (webhooks can arrive out of
// order), e.g. "delayed" arriving after "delivered" is ignored.
const RANK: Record<EmailStatus, number> = { sent: 0, delayed: 1, delivered: 2, bounced: 3, complained: 3, failed: 3 };
const PROBLEM: EmailStatus[] = ['bounced', 'complained', 'failed'];
const WORD: Record<string, string> = { bounced: 'bounced', complained: 'was marked as spam', failed: 'failed to send' };

export function statusFromWebhook(type: string): EmailStatus | null {
  switch (type) {
    case 'email.sent': return 'sent';
    case 'email.delivered': return 'delivered';
    case 'email.delivery_delayed': return 'delayed';
    case 'email.bounced': return 'bounced';
    case 'email.complained': return 'complained';
    case 'email.failed': return 'failed';
    default: return null;
  }
}

// Resend's "last_event" on GET /emails/{id}. Opened / clicked imply delivered.
export function statusFromLastEvent(ev: string | null | undefined): EmailStatus | null {
  switch (ev) {
    case 'delivered': case 'opened': case 'clicked': return 'delivered';
    case 'bounced': return 'bounced';
    case 'delivery_delayed': return 'delayed';
    case 'complained': return 'complained';
    case 'failed': case 'canceled': return 'failed';
    case 'sent': case 'queued': case 'scheduled': return 'sent';
    default: return null;
  }
}

const bareAddress = (s: string) => (s.match(/<([^>]+)>/)?.[1] ?? s).trim().toLowerCase();

export type ApplyResult = 'updated' | 'unchanged' | 'unknown';

// Record a delivery status against the payroll entry that sent this email.
// `recipients` (from the webhook) guards against a problem with a BCC copy
// being blamed on the employee: if the event lists recipients and the
// employee's address isn't one of them, it is ignored.
export function applyEmailStatus(
  db: Database.Database, emailId: string, status: EmailStatus, opts: { recipients?: string[]; detail?: string } = {},
): ApplyResult {
  const row = db.prepare(`
    SELECT id, payroll_period_id, employee_name_snapshot, payslip_emailed_to, payslip_email_status
    FROM payroll_entries WHERE payslip_email_id = ?
  `).get(emailId) as { id: number; payroll_period_id: number; employee_name_snapshot: string; payslip_emailed_to: string | null; payslip_email_status: string | null } | undefined;
  if (!row) return 'unknown';

  if (opts.recipients?.length && row.payslip_emailed_to) {
    const mine = row.payslip_emailed_to.trim().toLowerCase();
    if (!opts.recipients.some(r => bareAddress(String(r)) === mine)) return 'unchanged';
  }

  const current = (row.payslip_email_status as EmailStatus | null) ?? 'sent';
  if (status === current || RANK[status] < RANK[current]) return 'unchanged';

  db.prepare(`UPDATE payroll_entries SET payslip_email_status = ?, payslip_email_status_at = datetime('now') WHERE id = ?`).run(status, row.id);
  if (PROBLEM.includes(status)) {
    const why = opts.detail ? `: ${opts.detail.slice(0, 200)}` : '';
    db.prepare(`INSERT INTO payroll_audit_log (payroll_period_id, payroll_entry_id, actor_user_id, action, details) VALUES (?, ?, NULL, ?, ?)`)
      .run(row.payroll_period_id, row.id, `payslip_email_${status}`, `Payslip email to ${row.employee_name_snapshot} (${row.payslip_emailed_to ?? 'no address'}) ${WORD[status]}${why}`);
  }
  return 'updated';
}

// ---- Resend webhooks are signed with Svix: HMAC-SHA256 over "id.timestamp.body" ----
export function verifyWebhookSignature(
  secret: string, headers: { id: string | null; timestamp: string | null; signature: string | null }, rawBody: string, nowMs = Date.now(),
): boolean {
  const { id, timestamp, signature } = headers;
  if (!secret || !id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > 5 * 60) return false; // replay window
  let key: Buffer;
  try { key = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64'); } catch { return false; }
  if (key.length === 0) return false;
  const expected = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest();
  return signature.split(' ').some(part => {
    const [version, sig] = part.split(',');
    if (version !== 'v1' || !sig) return false;
    const given = Buffer.from(sig, 'base64');
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  });
}

export type LookupResult =
  | { ok: true; status: EmailStatus }
  | { ok: false; reason: 'no_key' | 'forbidden' | 'not_found' | 'unknown_event' | 'error' };

// Ask Resend directly for the current state of one email. Works only when the
// API key is allowed to read emails; otherwise the webhook is the way.
export async function lookupResendStatus(emailId: string): Promise<LookupResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, reason: 'no_key' };
  try {
    const res = await fetch(`https://api.resend.com/emails/${encodeURIComponent(emailId)}`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (res.status === 401 || res.status === 403) return { ok: false, reason: 'forbidden' };
    if (res.status === 404) return { ok: false, reason: 'not_found' };
    if (!res.ok) return { ok: false, reason: 'error' };
    const json = await res.json().catch(() => null) as { last_event?: string } | null;
    const status = statusFromLastEvent(json?.last_event);
    return status ? { ok: true, status } : { ok: false, reason: 'unknown_event' };
  } catch {
    return { ok: false, reason: 'error' };
  }
}
