import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

type FieldMode = 'required' | 'optional' | 'hidden';
const VALID_MODES: FieldMode[] = ['required', 'optional', 'hidden'];

function getField(db: ReturnType<typeof getDb>, key: string, fallback: FieldMode): FieldMode {
  const row = db.prepare('SELECT value FROM app_settings WHERE key=?').get(key) as { value: string } | undefined;
  const value = row?.value;
  return (VALID_MODES as string[]).includes(value ?? '') ? (value as FieldMode) : fallback;
}

// Public — the booking form reads this to know which optional fields to
// show, require, or hide. Mobile Number defaults to required (needed for
// SMS reminders) until the owner explicitly changes it.
export async function GET() {
  try {
    const db = getDb();
    return NextResponse.json({
      contact: getField(db, 'booking_field_contact', 'required'),
      experience: getField(db, 'booking_field_experience', 'optional'),
      goal: getField(db, 'booking_field_goal', 'optional'),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
