import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const db        = getDb();
    const partnerId = req.nextUrl.searchParams.get('partner_id');
    const period       = req.nextUrl.searchParams.get('period') ?? 'lifetime';
    const monthParam   = req.nextUrl.searchParams.get('month') ?? '';

    let dateFilter = '';
    if (period === 'today')          dateFilter = `AND date(ps.sale_date) = date('now')`;
    else if (period === 'yesterday') dateFilter = `AND date(ps.sale_date) = date('now', '-1 day')`;
    else if (period === '7days')     dateFilter = `AND ps.sale_date >= datetime('now', '-7 days')`;
    else if (period === 'this_month') dateFilter = `AND strftime('%Y-%m', ps.sale_date) = strftime('%Y-%m', 'now')`;
    else if (period === 'last_month') dateFilter = `AND strftime('%Y-%m', ps.sale_date) = strftime('%Y-%m', 'now', '-1 month')`;
    else if (period === 'month' && monthParam) dateFilter = `AND strftime('%Y-%m', ps.sale_date) = '${monthParam}'`;

    const partnerFilter = partnerId ? `AND ps.partner_id = ${parseInt(partnerId)}` : '';

    const rows = db.prepare(`
      SELECT
        p.id, p.name, p.company_name, p.subscription,
        COALESCE(SUM(ps.amount), 0) AS gross_sales,
        COUNT(ps.id) AS entry_count
      FROM partners p
      LEFT JOIN partner_sales ps ON ps.partner_id = p.id ${dateFilter} ${partnerFilter}
      WHERE p.onboarding = 'DONE'
      GROUP BY p.id
      ORDER BY gross_sales DESC
    `).all();

    const total = (rows as { gross_sales: number }[]).reduce((s, r) => s + r.gross_sales, 0);
    return NextResponse.json({ rows, total });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = getDb();
    const { partner_id, amount, period_label, sale_date, notes } = await req.json();
    const info = db.prepare(
      'INSERT INTO partner_sales (partner_id, amount, period_label, sale_date, notes) VALUES (?,?,?,?,?)'
    ).run(partner_id, amount, period_label ?? null, sale_date ?? null, notes ?? null);
    return NextResponse.json({ id: Number(info.lastInsertRowid) }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
