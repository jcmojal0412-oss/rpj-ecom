import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Read by every cashier (any 'pos'-permitted user, per middleware) so the
// checkout UI can render correctly for whoever's on shift — this is a
// low-sensitivity toggle, not a secret.
export async function GET() {
  try {
    const db = getDb();
    const row = db.prepare(`SELECT value FROM app_settings WHERE key = 'pos_allow_zero_stock'`).get() as { value: string } | undefined;
    return NextResponse.json({ allow_zero_stock: row?.value === '1' });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// Owner-only to change — same pattern as Void Sale/Reopen Shift: this route
// lives under the 'pos'-permission-gated /api/pos prefix (so any cashier can
// GET it), but writing requires the owner role explicitly, checked here.
export async function PUT(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    if (session.role !== 'owner') return NextResponse.json({ error: 'Only the owner can change this setting' }, { status: 403 });

    const { allow_zero_stock } = await req.json();
    const db = getDb();
    db.prepare(`INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pos_allow_zero_stock', ?)`).run(allow_zero_stock ? '1' : '0');
    return NextResponse.json({ ok: true, allow_zero_stock: !!allow_zero_stock });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
