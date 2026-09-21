import { NextResponse } from 'next/server';
import { calendarRoute } from '@/lib/calendar-http';
import { CATEGORIES } from '@/lib/calendar';

// Everything the calendar screen needs to build its forms and filters.
export const GET = calendarRoute(async (_req, { db, caps, today }) => {
  const businessUnits = db.prepare('SELECT id, name FROM calendar_business_units WHERE active = 1 ORDER BY sort_order, name').all();
  // "Assigned To": active people only, names only — nothing else about them.
  const people = db.prepare("SELECT id, name FROM users WHERE active = 1 ORDER BY name COLLATE NOCASE").all();
  return NextResponse.json({
    today, categories: CATEGORIES, business_units: businessUnits, people,
    caps: { user_id: caps.userId, is_owner: caps.isOwner, finance: caps.finance, payroll: caps.payroll },
  });
}, { maintain: false });
