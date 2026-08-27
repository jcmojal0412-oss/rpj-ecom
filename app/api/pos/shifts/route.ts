import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const { searchParams } = new URL(req.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const businessId = searchParams.get('business_id');
    const username = searchParams.get('username');

    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (from) { clauses.push('s.time_in >= ?'); params.push(from); }
    if (to) { clauses.push('s.time_in <= ?'); params.push(`${to} 23:59:59`); }
    if (businessId) { clauses.push('s.business_id = ?'); params.push(Number(businessId)); }
    if (username) { clauses.push('(u.username LIKE ? OR u.name LIKE ?)'); params.push(`%${username}%`, `%${username}%`); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const rows = db.prepare(`
      SELECT s.*, u.name as cashier_name, u.username, b.name as business_name
      FROM pos_shifts s
      LEFT JOIN users u ON u.id = s.cashier_id
      LEFT JOIN businesses b ON b.id = s.business_id
      ${where}
      ORDER BY s.time_in DESC
    `).all(...params);

    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const db = getDb();
    const { business_id, starting_cash } = await req.json();
    if (!business_id) return NextResponse.json({ error: 'Business is required' }, { status: 400 });

    const existing = db.prepare(
      `SELECT id FROM pos_shifts WHERE business_id = ? AND cashier_id = ? AND status = 'Open'`
    ).get(business_id, session.id);
    if (existing) return NextResponse.json({ error: 'You already have an open shift for this business' }, { status: 400 });

    const startingCashNum = starting_cash ? parseFloat(starting_cash) : 0;
    const info = db.prepare(`
      INSERT INTO pos_shifts (business_id, cashier_id, time_in, starting_cash, status)
      VALUES (?, ?, datetime('now'), ?, 'Open')
    `).run(business_id, session.id, startingCashNum);

    return NextResponse.json({ id: info.lastInsertRowid }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
