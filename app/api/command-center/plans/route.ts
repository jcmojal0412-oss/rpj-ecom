import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner') return NextResponse.json({ error: 'Not authorized' }, { status: 403 });

  const db = getDb();
  const plans = db.prepare(`SELECT * FROM cc_plans WHERE status != 'cancelled' ORDER BY status ASC, deadline IS NULL, deadline ASC`).all() as any[];
  const countStmt = db.prepare(`SELECT COUNT(*) as total, SUM(done) as done FROM cc_plan_tasks WHERE plan_id = ?`);

  const withCounts = plans.map(p => {
    const c = countStmt.get(p.id) as { total: number; done: number | null };
    return { ...p, task_total: c.total, task_done: c.done || 0 };
  });

  return NextResponse.json(withCounts);
}

// Creates a plan and its suggested-breakdown steps in one transaction — the
// AI-narration flow in the chat always sends the full step list up front
// (see buildPlanSummary() in lib/command-center.ts), so there's no
// "create empty plan, add steps one by one" round trip to support.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner') return NextResponse.json({ error: 'Not authorized' }, { status: 403 });

  try {
    const body = await req.json();
    if (!body.title?.trim()) return NextResponse.json({ error: 'Title is required' }, { status: 400 });

    const db = getDb();
    const steps: string[] = Array.isArray(body.tasks) ? body.tasks.filter((s: unknown) => typeof s === 'string' && s.trim()) : [];

    const insertPlan = db.prepare(`
      INSERT INTO cc_plans (title, goal, category, deadline, notes) VALUES (?, ?, ?, ?, ?)
    `);
    const insertTask = db.prepare(`INSERT INTO cc_plan_tasks (plan_id, label, sort_order) VALUES (?, ?, ?)`);

    const planId = db.transaction(() => {
      const info = insertPlan.run(
        body.title.trim(),
        body.goal?.trim() || null,
        body.category?.trim() || null,
        body.deadline || null,
        body.notes?.trim() || null,
      );
      const id = Number(info.lastInsertRowid);
      steps.forEach((label, i) => insertTask.run(id, label.trim(), i));
      return id;
    })();

    return NextResponse.json({ id: planId }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
