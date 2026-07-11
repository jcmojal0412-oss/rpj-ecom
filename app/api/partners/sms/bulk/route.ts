import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { sendSms } from '@/lib/sms';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { ids, message } = await req.json();
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'ids array is required' }, { status: 400 });
    }
    if (!message?.trim()) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    const db = getDb();
    let sent = 0, failed = 0, noContact = 0;
    let lastError: string | undefined;

    for (const id of ids as number[]) {
      const partner = db.prepare('SELECT contact FROM partners WHERE id=?').get(id) as { contact: string | null } | undefined;
      if (!partner) continue;
      if (!partner.contact?.trim()) {
        noContact++;
        continue;
      }
      const result = await sendSms(partner.contact, message.trim());
      if (result.sent) {
        sent++;
      } else {
        failed++;
        lastError = result.error;
      }
    }

    return NextResponse.json({ sent, failed, noContact, lastError });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
