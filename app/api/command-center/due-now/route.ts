import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { todayISO } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// Same "+8h then read the UTC parts" trick as lib/utils.ts's todayISO(), so
// due_time/recurrence_day (entered as PH-local by the owner/Goldie) compare
// correctly regardless of the server's actual timezone (Railway runs UTC).
function phNow(): Date {
  return new Date(Date.now() + 8 * 60 * 60 * 1000);
}
function currentTimeHHMM(): string {
  const d = phNow();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
function currentWeekday(): string {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  return days[phNow().getUTCDay()];
}
function currentDayOfMonth(): string {
  return String(phNow().getUTCDate());
}

// Polled by the client every ~60s while the Command Center page is open.
// Finds tasks/reminders that are due "now" and haven't already been spoken
// today (cc_notifications is the dedupe log — see lib/db.ts), atomically
// logs the ones it's about to return, and only returns those. No separate
// ack call needed: by construction, only-just-inserted rows come back.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner') return NextResponse.json({ error: 'Not authorized' }, { status: 403 });

  const db = getDb();
  const today = todayISO();
  const nowTime = currentTimeHHMM();
  const weekday = currentWeekday();
  const dayOfMonth = currentDayOfMonth();

  const dueTasks = db.prepare(`
    SELECT id, title, category, priority FROM cc_tasks
    WHERE due_date = ? AND status NOT IN ('Completed','Cancelled')
      AND (due_time IS NULL OR due_time <= ?)
  `).all(today, nowTime) as { id: number; title: string; category: string | null; priority: string }[];

  const dueOnceReminders = db.prepare(`
    SELECT id, title, category FROM cc_reminders
    WHERE status = 'active' AND recurrence = 'once' AND remind_date = ?
      AND (remind_time IS NULL OR remind_time <= ?)
  `).all(today, nowTime) as { id: number; title: string; category: string | null }[];

  const dueDailyReminders = db.prepare(`
    SELECT id, title, category FROM cc_reminders
    WHERE status = 'active' AND recurrence = 'daily'
      AND (remind_time IS NULL OR remind_time <= ?)
  `).all(nowTime) as { id: number; title: string; category: string | null }[];

  const dueWeeklyReminders = db.prepare(`
    SELECT id, title, category FROM cc_reminders
    WHERE status = 'active' AND recurrence = 'weekly' AND recurrence_day = ?
      AND (remind_time IS NULL OR remind_time <= ?)
  `).all(weekday, nowTime) as { id: number; title: string; category: string | null }[];

  const dueMonthlyReminders = db.prepare(`
    SELECT id, title, category FROM cc_reminders
    WHERE status = 'active' AND recurrence = 'monthly' AND recurrence_day = ?
      AND (remind_time IS NULL OR remind_time <= ?)
  `).all(dayOfMonth, nowTime) as { id: number; title: string; category: string | null }[];

  const insertNotif = db.prepare(`INSERT OR IGNORE INTO cc_notifications (entity_type, entity_id, fired_for_date, spoken_text) VALUES (?, ?, ?, ?)`);
  const closeOnceReminder = db.prepare(`UPDATE cc_reminders SET status = 'done' WHERE id = ?`);

  const due: { type: 'task' | 'reminder'; id: number; title: string; category: string | null; priority?: string }[] = [];

  for (const t of dueTasks) {
    const spoken = `Boss, ${t.title} — ito ang task mo ngayon, dapat mo tapusin.`;
    const info = insertNotif.run('task', t.id, today, spoken);
    if (info.changes > 0) due.push({ type: 'task', id: t.id, title: t.title, category: t.category, priority: t.priority });
  }

  const allReminders = [...dueOnceReminders, ...dueDailyReminders, ...dueWeeklyReminders, ...dueMonthlyReminders];
  for (const r of allReminders) {
    const spoken = `Boss, paalala — ${r.title}.`;
    const info = insertNotif.run('reminder', r.id, today, spoken);
    if (info.changes > 0) {
      due.push({ type: 'reminder', id: r.id, title: r.title, category: r.category });
      if (dueOnceReminders.some(x => x.id === r.id)) closeOnceReminder.run(r.id);
    }
  }

  return NextResponse.json({ due });
}
