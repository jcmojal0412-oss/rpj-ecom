import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const db = getDb();
    const shift = db.prepare('SELECT cashier_id FROM pos_shifts WHERE id = ?').get(params.id) as { cashier_id: number } | undefined;
    if (!shift) return NextResponse.json({ error: 'Shift not found' }, { status: 404 });
    if (shift.cashier_id !== session.id && session.role !== 'owner' && !session.permissions.includes('pos_reports')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const rows = db.prepare(`
      SELECT m.*, u.name as created_by_name
      FROM pos_shift_cash_movements m
      LEFT JOIN users u ON u.id = m.created_by
      WHERE m.shift_id = ? ORDER BY m.created_at
    `).all(params.id);
    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const db = getDb();
    const shift = db.prepare('SELECT id, cashier_id, status FROM pos_shifts WHERE id = ?').get(params.id) as
      { id: number; cashier_id: number; status: string } | undefined;
    if (!shift) return NextResponse.json({ error: 'Shift not found' }, { status: 404 });
    if (shift.status === 'Closed') return NextResponse.json({ error: 'This shift is already closed' }, { status: 400 });
    if (shift.cashier_id !== session.id && session.role !== 'owner') {
      return NextResponse.json({ error: 'Not authorized for this shift' }, { status: 403 });
    }

    const { type, amount, note } = await req.json();
    if (type !== 'IN' && type !== 'OUT') return NextResponse.json({ error: 'Invalid movement type' }, { status: 400 });
    const amountNum = parseFloat(amount);
    if (!amountNum || amountNum <= 0) return NextResponse.json({ error: 'Amount must be greater than 0' }, { status: 400 });

    const info = db.prepare(
      'INSERT INTO pos_shift_cash_movements (shift_id, type, amount, note, created_by) VALUES (?,?,?,?,?)'
    ).run(shift.id, type, amountNum, note?.trim() || null, session.id);

    return NextResponse.json({ id: info.lastInsertRowid }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
