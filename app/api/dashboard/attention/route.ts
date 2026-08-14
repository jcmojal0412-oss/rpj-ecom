import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { todayISO } from '@/lib/utils';

export const dynamic = 'force-dynamic';

interface AttentionItem { key: string; title: string; count: number; unit: string; href: string; }

// Powers the "Attention Needed" panel on the main Operations Dashboard —
// one call aggregating real, already-existing actionable counts (never
// fabricated). Each category is only included if the current session has
// the matching module permission (mirrors middleware.ts's ROUTE_MODULES
// gates) and only if its count is actually > 0.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const db = getDb();
  const isOwner = session.role === 'owner';
  const has = (m: string) => isOwner || session.permissions.includes(m);
  const items: AttentionItem[] = [];

  if (has('inventory')) {
    const c = (db.prepare(`
      SELECT COUNT(*) as c FROM products p LEFT JOIN inventory i ON i.product_id = p.id
      WHERE COALESCE(i.quantity, 0) <= p.reorder_point
    `).get() as { c: number }).c;
    if (c > 0) items.push({
      key: 'low_stock', title: 'Low Stock', count: c,
      unit: c === 1 ? 'item needs attention' : 'items need attention', href: '/inventory',
    });
  }

  if (has('purchase_orders')) {
    const c = (db.prepare(`SELECT COUNT(*) as c FROM purchase_orders WHERE status='pending'`).get() as { c: number }).c;
    if (c > 0) items.push({
      key: 'pending_po', title: 'Purchase Orders', count: c,
      unit: c === 1 ? 'pending order' : 'pending orders', href: '/purchase-orders',
    });
  }

  if (has('service_center')) {
    const c = (db.prepare(`SELECT COUNT(*) as c FROM service_repairs WHERE status='ONGOING'`).get() as { c: number }).c;
    if (c > 0) items.push({
      key: 'service_center', title: 'Service Center', count: c,
      unit: c === 1 ? 'ongoing repair' : 'ongoing repairs', href: '/service-center',
    });
  }

  if (has('attendance')) {
    const today = todayISO();
    const otC = (db.prepare(`SELECT COUNT(*) as c FROM attendance_ot_requests WHERE status='pending'`).get() as { c: number }).c;
    const corrC = (db.prepare(`SELECT COUNT(*) as c FROM attendance_corrections WHERE status='pending'`).get() as { c: number }).c;
    const leaveC = (db.prepare(`SELECT COUNT(*) as c FROM leave_requests WHERE status='pending'`).get() as { c: number }).c;
    const missingC = (db.prepare(`
      SELECT COUNT(DISTINCT e.id) as c
      FROM attendance_events ev
      JOIN employees e ON e.id = ev.employee_id
      WHERE ev.event_date = ? AND ev.event_type = 'TIME_IN' AND ev.superseded_by IS NULL AND ev.is_test = 0
        AND e.employment_status = 'Active' AND e.attendance_enabled = 1
        AND NOT EXISTS (
          SELECT 1 FROM attendance_events t
          WHERE t.employee_id = e.id AND t.event_date = ? AND t.event_type = 'TIME_OUT' AND t.superseded_by IS NULL AND t.is_test = 0
        )
    `).get(today, today) as { c: number }).c;
    const total = otC + corrC + leaveC + missingC;
    if (total > 0) items.push({
      key: 'hr', title: 'HR & Payroll', count: total,
      unit: total === 1 ? 'item needs review' : 'items need review', href: '/hr-dashboard',
    });
  }

  return NextResponse.json({ items });
}
