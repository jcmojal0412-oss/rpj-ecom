import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { todayISO } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner') return NextResponse.json({ error: 'Not authorized' }, { status: 403 });

  const db = getDb();
  const today = todayISO();

  const today_count = (db.prepare(`SELECT COUNT(*) as c FROM cc_tasks WHERE due_date = ? AND status != 'Cancelled'`).get(today) as { c: number }).c;
  const urgent = (db.prepare(`SELECT COUNT(*) as c FROM cc_tasks WHERE priority = 'Urgent' AND status NOT IN ('Completed','Cancelled')`).get() as { c: number }).c;
  const overdue = (db.prepare(`SELECT COUNT(*) as c FROM cc_tasks WHERE due_date < ? AND status NOT IN ('Completed','Cancelled')`).get(today) as { c: number }).c;
  const followups = (db.prepare(`SELECT COUNT(*) as c FROM cc_follow_ups WHERE status = 'waiting'`).get() as { c: number }).c;
  const completed = (db.prepare(`SELECT COUNT(*) as c FROM cc_tasks WHERE status = 'Completed' AND date(completed_at) = ?`).get(today) as { c: number }).c;

  const topPriorities = db.prepare(`
    SELECT title, category, due_time FROM cc_tasks
    WHERE due_date = ? AND status NOT IN ('Completed','Cancelled')
    ORDER BY CASE priority WHEN 'Urgent' THEN 0 WHEN 'High' THEN 1 WHEN 'Normal' THEN 2 ELSE 3 END, due_time IS NULL, due_time ASC
    LIMIT 5
  `).all(today) as { title: string; category: string | null; due_time: string | null }[];

  return NextResponse.json({
    today: today_count, urgent, overdue, followups, completed,
    topPriorities: topPriorities.map(t => ({ title: t.title, sub: t.category || '', time: t.due_time || '' })),
    meetingsToday: [], // no calendar integration in V1 — Dashboard shows this section empty rather than faking data
  });
}
