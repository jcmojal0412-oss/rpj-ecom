import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Flat payout history across all repairs, for the "View Payout History" list.
export async function GET() {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT t.id, t.repair_id, t.amount, t.payment_date, t.payment_method, t.reference_notes, t.created_at,
             u.name as processed_by_name,
             r.repair_details, r.unit_model, r.technician_name
      FROM service_repair_tech_payouts t
      JOIN service_repairs r ON r.id = t.repair_id
      LEFT JOIN users u ON u.id = t.processed_by
      ORDER BY t.payment_date DESC, t.id DESC
    `).all();
    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// Pays out the full remaining tech_payable for each selected repair in one
// batch — one payout ledger row per repair, sharing the same payment_date/
// method/reference, amount computed server-side (never trusted from the
// client) so a stale UI can't under- or over-pay a technician.
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { repair_ids, payment_date, payment_method, reference_notes } = await req.json();

    if (!Array.isArray(repair_ids) || repair_ids.length === 0) {
      return NextResponse.json({ error: 'repair_ids must be a non-empty array' }, { status: 400 });
    }
    if (!payment_date) {
      return NextResponse.json({ error: 'payment_date is required' }, { status: 400 });
    }

    const db = getDb();
    const placeholders = repair_ids.map(() => '?').join(',');
    const repairs = db.prepare(`
      SELECT r.id, r.gerald_share as tech_earnings, r.repair_status, COALESCE(t.paid_out, 0) as paid_out
      FROM service_repairs r
      LEFT JOIN (SELECT repair_id, SUM(amount) as paid_out FROM service_repair_tech_payouts GROUP BY repair_id) t ON t.repair_id = r.id
      WHERE r.id IN (${placeholders})
    `).all(...repair_ids) as { id: number; tech_earnings: number; repair_status: string | null; paid_out: number }[];

    const insertPayout = db.prepare(`
      INSERT INTO service_repair_tech_payouts (repair_id, amount, payment_date, payment_method, reference_notes, processed_by)
      VALUES (?,?,?,?,?,?)
    `);

    // Enforced here too, not just via the disabled checkbox in the UI — a
    // payout is only real once the repair is actually finished, regardless
    // of what a stale client sends.
    const paid: { repair_id: number; amount: number }[] = [];
    const skipped: number[] = [];
    const runPayouts = db.transaction(() => {
      for (const r of repairs) {
        const payable = r.tech_earnings - r.paid_out;
        const due = r.repair_status === 'Ready for Pickup' || r.repair_status === 'Completed';
        if (payable > 0.005 && due) {
          insertPayout.run(r.id, payable, payment_date, payment_method?.trim() || null, reference_notes?.trim() || null, session.id);
          paid.push({ repair_id: r.id, amount: payable });
        } else if (payable > 0.005) {
          skipped.push(r.id);
        }
      }
    });
    runPayouts();

    return NextResponse.json({ paid, skipped }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
