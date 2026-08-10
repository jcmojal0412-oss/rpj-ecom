import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { todayISO } from '@/lib/utils';

export const dynamic = 'force-dynamic';

type Period = 'today' | 'yesterday' | 'weekly' | 'this_month' | 'last_month' | 'custom';

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function resolveRange(period: Period, customFrom?: string, customTo?: string) {
  const today = todayISO();
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();

  switch (period) {
    case 'yesterday': {
      const d = new Date(now);
      d.setDate(d.getDate() - 1);
      const ds = iso(d);
      return { from: ds, to: ds, label: 'Yesterday' };
    }
    case 'weekly': {
      const d = new Date(now);
      d.setDate(d.getDate() - 6);
      return { from: iso(d), to: today, label: 'Weekly (Last 7 Days)' };
    }
    case 'this_month': {
      const first = new Date(y, m, 1);
      return { from: iso(first), to: today, label: 'This Month' };
    }
    case 'last_month': {
      const firstLast = new Date(y, m - 1, 1);
      const lastLast = new Date(y, m, 0);
      return { from: iso(firstLast), to: iso(lastLast), label: 'Last Month' };
    }
    case 'custom': {
      const from = customFrom || today;
      const to = customTo || today;
      return { from, to, label: from === to ? from : `${from} – ${to}` };
    }
    case 'today':
    default:
      return { from: today, to: today, label: 'Today' };
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const period = (searchParams.get('period') || 'today') as Period;
    const customFrom = searchParams.get('from') || undefined;
    const customTo = searchParams.get('to') || undefined;

    const { from, to, label } = resolveRange(period, customFrom, customTo);

    const db = getDb();
    const value = (db.prepare(`
      SELECT COALESCE(SUM(sm.quantity * p.cogs), 0) as value
      FROM stock_movements sm JOIN products p ON p.id = sm.product_id
      WHERE sm.type='OUT' AND date(sm.moved_at) BETWEEN ? AND ?
    `).get(from, to) as { value: number }).value;

    return NextResponse.json({ value, from, to, label });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
