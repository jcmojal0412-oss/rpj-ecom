import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { todayISO } from '@/lib/attendance';

export const dynamic = 'force-dynamic';

const UPCOMING_WINDOW_DAYS = 7;

interface EmployeeBirthday {
  id: number;
  full_name: string;
  position: string | null;
  birthday: string;
}

// Next occurrence of this employee's birthday (month/day only — the stored
// birthday's own year only matters for the turning-age math below) plus
// how many days from today that falls. A Feb 29 birthday in a non-leap
// target year rolls to Mar 1 via JS Date's own overflow behavior — an
// accepted, common convention, not worth a special case.
function nextOccurrence(birthday: string, today: string): { daysUntil: number; year: number } {
  const [, bm, bd] = birthday.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  const todayUTC = Date.UTC(ty, tm - 1, td);
  let year = ty;
  let occurrenceUTC = Date.UTC(year, bm - 1, bd);
  if (occurrenceUTC < todayUTC) {
    year += 1;
    occurrenceUTC = Date.UTC(year, bm - 1, bd);
  }
  return { daysUntil: Math.round((occurrenceUTC - todayUTC) / 86_400_000), year };
}

// Powers the HR Dashboard's "🎂 Birthdays" card — employees with a
// birthday today get top billing, everyone else within the next 7 days
// shows as a heads-up so HR isn't caught off guard. Same Active +
// Attendance Enabled population as the rest of the HR Dashboard; an
// employee with no birthday on file is simply excluded, not an error.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('attendance')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const db = getDb();
  const today = todayISO();

  const employees = db.prepare(`
    SELECT id, full_name, position, birthday FROM employees
    WHERE employment_status = 'Active' AND attendance_enabled = 1
      AND birthday IS NOT NULL AND birthday != ''
  `).all() as EmployeeBirthday[];

  const withOccurrence = employees.map(e => {
    const { daysUntil, year } = nextOccurrence(e.birthday, today);
    const birthYear = Number(e.birthday.split('-')[0]);
    return { id: e.id, full_name: e.full_name, position: e.position, daysUntil, turning: year - birthYear };
  });

  const todayList = withOccurrence
    .filter(e => e.daysUntil === 0)
    .map(({ id, full_name, position, turning }) => ({ id, full_name, position, turning }));

  const upcoming = withOccurrence
    .filter(e => e.daysUntil > 0 && e.daysUntil <= UPCOMING_WINDOW_DAYS)
    .sort((a, b) => a.daysUntil - b.daysUntil);

  return NextResponse.json({ today: todayList, upcoming });
}
