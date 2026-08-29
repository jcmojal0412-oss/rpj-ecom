import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { verifyPassword } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';

// Lets a cashier's own UI check a PIN before showing an owner-gated form,
// so a wrong PIN is caught immediately instead of after filling everything
// out. This is a convenience check only — the action the PIN is meant to
// unlock (e.g. POST /api/pos/sales/backfill) re-verifies the PIN itself
// server-side; passing this check alone authorizes nothing.
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { pin } = await req.json();
    const db = getDb();
    const row = db.prepare(`SELECT value FROM app_settings WHERE key = 'pos_manager_pin_hash'`).get() as { value: string } | undefined;
    if (!row?.value) return NextResponse.json({ ok: false, error: 'No manager PIN has been set up yet — ask the owner to set one first.' });
    if (!pin || !verifyPassword(String(pin), row.value)) return NextResponse.json({ ok: false, error: 'Incorrect PIN' });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
