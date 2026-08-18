import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { todayISO } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// Suggests the next sequential Order No. for a new repair, formatted
// BNS-{year}-{4-digit sequence}. Seeded at 0888 for 2026 to continue the
// shop's existing order-book numbering; every later year starts fresh at
// 0001. This is only a starting suggestion shown in the form — the field
// stays editable and nothing in the database enforces uniqueness.
export async function GET() {
  try {
    const db = getDb();
    const year = Number(todayISO().slice(0, 4));
    const prefix = `BNS-${year}-`;
    const rows = db.prepare(
      `SELECT order_no FROM service_repairs WHERE order_no LIKE ?`
    ).all(`${prefix}%`) as { order_no: string }[];

    let maxNum = year === 2026 ? 887 : 0;
    for (const r of rows) {
      const m = /^BNS-\d{4}-(\d+)$/.exec(r.order_no || '');
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > maxNum) maxNum = n;
      }
    }

    const order_no = `${prefix}${String(maxNum + 1).padStart(4, '0')}`;
    return NextResponse.json({ order_no });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
