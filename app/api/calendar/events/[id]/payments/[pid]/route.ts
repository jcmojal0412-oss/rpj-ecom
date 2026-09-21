import { NextResponse } from 'next/server';
import { calendarRoute, idOf } from '@/lib/calendar-http';
import { CalendarError, voidPayment } from '@/lib/calendar-service';

// A payment is never erased — it is voided with a reason, and stays in the history.
export const DELETE = calendarRoute<{ id: string; pid: string }>(async (req, { db, caps, today }, { id, pid }) => {
  let body: { reason?: string } = {};
  try { body = await req.json(); } catch { /* reason is checked below */ }
  const paymentId = Number(pid);
  if (!Number.isInteger(paymentId) || paymentId <= 0) throw new CalendarError('Payment not found.', 404);
  voidPayment(db, caps, idOf(id), paymentId, body.reason ?? null, today);
  return NextResponse.json({ ok: true });
});
