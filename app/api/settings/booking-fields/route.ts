import { NextRequest, NextResponse } from 'next/server';
import { getDb, runTransaction } from '@/lib/db';

export const dynamic = 'force-dynamic';

type FieldMode = 'required' | 'optional' | 'hidden';
const VALID_MODES: FieldMode[] = ['required', 'optional', 'hidden'];

function getField(db: ReturnType<typeof getDb>, key: string): FieldMode {
  const row = db.prepare('SELECT value FROM app_settings WHERE key=?').get(key) as { value: string } | undefined;
  const value = row?.value;
  return (VALID_MODES as string[]).includes(value ?? '') ? (value as FieldMode) : 'optional';
}

export async function GET() {
  try {
    const db = getDb();
    return NextResponse.json({
      contact: getField(db, 'booking_field_contact'),
      experience: getField(db, 'booking_field_experience'),
      goal: getField(db, 'booking_field_goal'),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { contact, experience, goal } = await req.json();
    for (const v of [contact, experience, goal]) {
      if (!VALID_MODES.includes(v)) {
        return NextResponse.json({ error: `Invalid field mode: ${v}` }, { status: 400 });
      }
    }

    const db = getDb();
    runTransaction(() => {
      db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('booking_field_contact', ?)").run(contact);
      db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('booking_field_experience', ?)").run(experience);
      db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('booking_field_goal', ?)").run(goal);
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
