import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { applyEmailStatus, statusFromWebhook, verifyWebhookSignature } from '@/lib/email-status';

export const dynamic = 'force-dynamic';

// Receives Resend's delivery events (delivered / bounced / delayed / spam
// complaint) for payslip emails. It lives under /api/public because Resend has
// no login, so the ONLY thing protecting it is the signature check: without
// RESEND_WEBHOOK_SECRET set, or with a bad / stale signature, nothing is read
// or written.
export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'Webhook is not configured.' }, { status: 503 });

  const raw = await req.text();
  const ok = verifyWebhookSignature(secret, {
    id: req.headers.get('svix-id'),
    timestamp: req.headers.get('svix-timestamp'),
    signature: req.headers.get('svix-signature'),
  }, raw);
  if (!ok) return NextResponse.json({ error: 'Invalid signature.' }, { status: 401 });

  let event: { type?: string; data?: { email_id?: string; to?: unknown; bounce?: { message?: string } } };
  try { event = JSON.parse(raw); } catch { return NextResponse.json({ error: 'Bad payload.' }, { status: 400 }); }

  const status = statusFromWebhook(String(event.type ?? ''));
  const emailId = event.data?.email_id;
  // Valid but not something we track (other apps' emails, opens, clicks…):
  // acknowledge so Resend doesn't keep retrying.
  if (!status || typeof emailId !== 'string' || !emailId) return NextResponse.json({ ok: true, ignored: true });

  const recipients = Array.isArray(event.data?.to) ? (event.data!.to as unknown[]).filter((x): x is string => typeof x === 'string') : undefined;
  const result = applyEmailStatus(getDb(), emailId, status, { recipients, detail: event.data?.bounce?.message });
  return NextResponse.json({ ok: true, result });
}
