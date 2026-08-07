import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { computeDaySummary, todayISO, type AttendanceEvent } from '@/lib/attendance';
import { loadGlobalBreakSettings, mergeShiftIntoSettings, getShiftForUserOnDate, type ShiftTemplate } from '@/lib/attendance-shifts';

export const dynamic = 'force-dynamic';

// Preview-only: computes the same DaySummary a real report would, but
// sourced ONLY from is_test = 1 rows for the given employee/date, against
// whichever shift was picked in Test Mode (or the employee's real assigned
// shift as a fallback) — never touches or is touched by
// /api/attendance/records (the real report), which explicitly excludes
// is_test = 1.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('attendance')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const userId = req.nextUrl.searchParams.get('user_id');
  const date = req.nextUrl.searchParams.get('date');
  const shiftIdParam = req.nextUrl.searchParams.get('shift_id');
  if (!userId || !date) return NextResponse.json({ error: 'user_id and date are required' }, { status: 400 });

  const db = getDb();
  const shift: ShiftTemplate | null = shiftIdParam
    ? (db.prepare('SELECT * FROM attendance_shifts WHERE id = ?').get(Number(shiftIdParam)) as ShiftTemplate | undefined) ?? null
    : getShiftForUserOnDate(db, Number(userId), date);
  if (!shift) return NextResponse.json({ error: 'No shift selected and the employee has no assigned shift for this date.' }, { status: 400 });

  const settings = mergeShiftIntoSettings(loadGlobalBreakSettings(db), shift);

  const events = db.prepare(`
    SELECT id, event_type, event_time, superseded_by FROM attendance_events
    WHERE user_id = ? AND event_date = ? AND is_test = 1
    ORDER BY event_time ASC
  `).all(userId, date) as AttendanceEvent[];

  // Treat any date other than "today" as finalized (a simulated past/future
  // day is always a complete, closed day for preview purposes).
  const isFinalized = date !== todayISO() || events.some(e => e.event_type === 'TIME_OUT');
  const summary = computeDaySummary(events, settings, isFinalized);

  return NextResponse.json({ summary, isFinalized, shift });
}
