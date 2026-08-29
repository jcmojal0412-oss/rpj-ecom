import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { hashPassword } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';

// A single shared PIN (not per-user) — the owner sets it once, then types
// it in person whenever a cashier needs to trigger an owner-gated POS
// action without the owner actually logging in on that terminal. Hashed at
// rest with the same hashPassword() used for real account passwords; never
// returned to the client once set.
export async function GET() {
  try {
    const db = getDb();
    const row = db.prepare(`SELECT value FROM app_settings WHERE key = 'pos_manager_pin_hash'`).get() as { value: string } | undefined;
    return NextResponse.json({ is_set: !!row?.value });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// Owner-only to set/change.
export async function PUT(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    if (session.role !== 'owner') return NextResponse.json({ error: 'Only the owner can set the manager PIN' }, { status: 403 });

    const { pin } = await req.json();
    if (!/^\d{4,6}$/.test(String(pin ?? ''))) {
      return NextResponse.json({ error: 'PIN must be 4 to 6 digits' }, { status: 400 });
    }

    const db = getDb();
    db.prepare(`INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pos_manager_pin_hash', ?)`).run(hashPassword(String(pin)));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
