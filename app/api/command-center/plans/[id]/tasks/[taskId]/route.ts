import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: { id: string; taskId: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner') return NextResponse.json({ error: 'Not authorized' }, { status: 403 });

  const planId = Number(params.id);
  const taskId = Number(params.taskId);
  if (!planId || !taskId) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  try {
    const body = await req.json();
    const db = getDb();
    const task = db.prepare('SELECT * FROM cc_plan_tasks WHERE id = ? AND plan_id = ?').get(taskId, planId);
    if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    db.transaction(() => {
      db.prepare('UPDATE cc_plan_tasks SET done = ? WHERE id = ?').run(body.done ? 1 : 0, taskId);
      const counts = db.prepare('SELECT COUNT(*) as total, SUM(done) as done FROM cc_plan_tasks WHERE plan_id = ?').get(planId) as { total: number; done: number | null };
      const progress = counts.total > 0 ? Math.round(((counts.done || 0) / counts.total) * 100) : 0;
      db.prepare('UPDATE cc_plans SET progress = ? WHERE id = ?').run(progress, planId);
    })();

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
