import { NextResponse } from 'next/server';
import { calendarRoute, idOf } from '@/lib/calendar-http';
import { CalendarError, addPayment, type PaymentInput } from '@/lib/calendar-service';

// Mark as Paid / add a partial payment (or, for a collection, mark it received).
export const POST = calendarRoute<{ id: string }>(async (req, { db, caps, today }, { id }) => {
  let body: PaymentInput;
  try { body = await req.json(); } catch { throw new CalendarError('Invalid request.'); }
  const r = addPayment(db, caps, idOf(id), body, today);
  return NextResponse.json({ ok: true, ...r }, { status: 201 });
});
