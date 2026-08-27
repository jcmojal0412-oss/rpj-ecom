import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const LIST_SQL_BASE = `
  SELECT e.*, b.name as business_name, u.name as created_by_name
  FROM expenses e
  LEFT JOIN businesses b ON b.id = e.business_id
  LEFT JOIN users u ON u.id = e.created_by
  WHERE e.deleted_at IS NULL
`;

export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const { searchParams } = new URL(req.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const businessId = searchParams.get('business_id');
    const category = searchParams.get('category');
    const status = searchParams.get('status');
    const search = searchParams.get('search');

    const clauses: string[] = [];
    const params: (string | number)[] = [];

    if (from) { clauses.push('e.date >= ?'); params.push(from); }
    if (to) { clauses.push('e.date <= ?'); params.push(to); }
    if (businessId) { clauses.push('e.business_id = ?'); params.push(Number(businessId)); }
    if (category) { clauses.push('e.category = ?'); params.push(category); }
    if (status) { clauses.push('e.status = ?'); params.push(status); }
    if (search) {
      clauses.push('(e.paid_to LIKE ? OR e.reference_no LIKE ? OR e.description LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like);
    }

    const sql = LIST_SQL_BASE + clauses.map(c => ` AND ${c}`).join('') + ' ORDER BY e.date DESC, e.id DESC';
    const rows = db.prepare(sql).all(...params);
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
    const {
      business_id, category, date, amount, paid_to, payment_method,
      reference_no, notes, receipt_path, ai_processed, ai_confidence, force, shift_id,
    } = await req.json();

    if (!business_id) return NextResponse.json({ error: 'Business is required' }, { status: 400 });
    if (!category) return NextResponse.json({ error: 'Category is required' }, { status: 400 });
    if (!date) return NextResponse.json({ error: 'Expense date is required' }, { status: 400 });
    if (!paid_to || !paid_to.trim()) return NextResponse.json({ error: 'Paid To is required' }, { status: 400 });
    const amountNum = parseFloat(amount);
    if (!amountNum || amountNum <= 0) return NextResponse.json({ error: 'A positive amount is required' }, { status: 400 });

    const status = ai_processed ? 'For Review' : 'Verified';

    // Duplicate check + insert run inside one transaction so two
    // near-simultaneous submissions for the same real payment can't both
    // pass the check before either commits — same business+amount+date, or
    // a matching non-empty reference number. No image hashing (kept
    // intentionally simple).
    const runInsert = db.transaction(() => {
      if (!force) {
        const dupClauses = ['e.deleted_at IS NULL', '(e.business_id = ? AND e.amount = ? AND e.date = ?)'];
        const dupParams: (string | number)[] = [business_id, amountNum, date];
        if (reference_no && reference_no.trim()) {
          dupClauses[1] = `(${dupClauses[1]} OR e.reference_no = ?)`;
          dupParams.push(reference_no.trim());
        }
        const existing = db.prepare(`
          SELECT e.*, b.name as business_name FROM expenses e
          LEFT JOIN businesses b ON b.id = e.business_id
          WHERE ${dupClauses.join(' AND ')} LIMIT 1
        `).get(...dupParams);
        if (existing) return { duplicate: existing };
      }

      const info = db.prepare(`
        INSERT INTO expenses
          (date, amount, description, category, reference_no, paid_to, payment_method,
           business_id, receipt_path, ai_processed, ai_confidence, status, created_by, shift_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        date, amountNum, notes?.trim() || null, category,
        reference_no?.trim() || null, paid_to.trim(), payment_method?.trim() || null,
        business_id, receipt_path?.trim() || null,
        ai_processed ? 1 : 0, ai_confidence ? JSON.stringify(ai_confidence) : null,
        status, session.id, shift_id || null,
      );
      return { id: info.lastInsertRowid };
    });

    const result = runInsert();
    if ('duplicate' in result) {
      return NextResponse.json({ possible_duplicate: result.duplicate }, { status: 409 });
    }
    return NextResponse.json({ id: result.id, status }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
