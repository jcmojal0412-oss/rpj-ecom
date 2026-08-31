import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

function requireAdmin(session: Awaited<ReturnType<typeof getSession>>) {
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('payroll')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }
  return null;
}

// Currently just the OT multiplier — applied to every approved OT minute
// regardless of day type (this system has no separate rest-day/holiday OT
// rate yet). Read live at period-generation time and frozen onto each
// entry's ot_multiplier_snapshot, same as every other payroll input.
export async function GET() {
  const session = await getSession();
  const denied = requireAdmin(session);
  if (denied) return denied;

  const db = getDb();
  const row = db.prepare(`SELECT value FROM app_settings WHERE key = 'payroll_ot_multiplier'`).get() as { value: string } | undefined;
  return NextResponse.json({ ot_multiplier: row ? Number(row.value) : 1.25 });
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  const denied = requireAdmin(session);
  if (denied) return denied;

  try {
    const body = await req.json();
    const multiplier = Number(body.ot_multiplier);
    if (!Number.isFinite(multiplier) || multiplier < 1 || multiplier > 5) {
      return NextResponse.json({ error: 'OT multiplier must be a number between 1 and 5' }, { status: 400 });
    }

    const db = getDb();
    db.prepare(`
      INSERT INTO app_settings (key, value) VALUES ('payroll_ot_multiplier', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(String(multiplier));

    return NextResponse.json({ ok: true, ot_multiplier: multiplier });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
