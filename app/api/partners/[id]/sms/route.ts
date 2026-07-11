import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { sendSms } from '@/lib/sms';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { message } = await req.json();
    if (!message?.trim()) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    const db = getDb();
    const partner = db.prepare('SELECT contact FROM partners WHERE id=?').get(params.id) as { contact: string | null } | undefined;
    if (!partner) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!partner.contact?.trim()) {
      return NextResponse.json({ error: 'This person has no mobile number on file' }, { status: 400 });
    }

    const result = await sendSms(partner.contact, message.trim());
    if (!result.sent) {
      return NextResponse.json({ error: result.error || 'Failed to send SMS' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
