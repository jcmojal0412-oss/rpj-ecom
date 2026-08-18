import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { computeSplit, deriveCustomerPaymentStatus, deriveTechPayoutStatus, REPAIR_STATUSES, type RepairStatus } from '@/lib/service-center';

export const dynamic = 'force-dynamic';

interface RepairRow {
  id: number; repair_date: string; repair_details: string | null; unit_model: string | null;
  customer_name: string | null; contact_number: string | null; technician_name: string | null;
  order_no: string | null; receipt_no: string | null; notes: string | null;
  repair_amount: number; cogs: number; labor_amount: number; bns_share: number; tech_earnings: number;
  repair_status: RepairStatus | null;
  collected: number; last_payment_date: string | null;
  paid_out: number;
  created_at: string;
}

function withDerived(r: RepairRow) {
  const balance = Math.max(0, r.repair_amount - r.collected);
  const tech_payable = Math.max(0, r.tech_earnings - r.paid_out);
  return {
    ...r,
    balance,
    customer_payment_status: deriveCustomerPaymentStatus(r.collected, r.repair_amount),
    tech_payable,
    tech_payout_status: deriveTechPayoutStatus(r.paid_out, r.tech_earnings, r.repair_status),
  };
}

const LIST_SQL = `
  SELECT
    r.id, r.repair_date, r.repair_details, r.unit_model,
    r.customer_name, r.contact_number, r.technician_name,
    r.order_no, r.receipt_no, r.notes,
    r.cs_payment as repair_amount, r.cogs, r.labor_amount, r.bns_share, r.gerald_share as tech_earnings,
    r.repair_status,
    COALESCE(p.collected, 0) as collected, p.last_payment_date,
    COALESCE(t.paid_out, 0) as paid_out,
    r.created_at
  FROM service_repairs r
  LEFT JOIN (SELECT repair_id, SUM(amount) as collected, MAX(payment_date) as last_payment_date FROM service_repair_payments GROUP BY repair_id) p ON p.repair_id = r.id
  LEFT JOIN (SELECT repair_id, SUM(amount) as paid_out FROM service_repair_tech_payouts GROUP BY repair_id) t ON t.repair_id = r.id
  ORDER BY r.repair_date DESC, r.id DESC
`;

export async function GET() {
  try {
    const db = getDb();
    const rows = (db.prepare(LIST_SQL).all() as RepairRow[]).map(withDerived);
    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = getDb();
    const {
      repair_date, repair_details, unit_model, customer_name, contact_number, technician_name,
      order_no, receipt_no, notes, repair_amount, cogs, dp, repair_status,
    } = await req.json();

    if (!repair_date) {
      return NextResponse.json({ error: 'repair_date is required' }, { status: 400 });
    }
    const statusVal: RepairStatus = REPAIR_STATUSES.includes(repair_status) ? repair_status : 'Received';

    const csNum = repair_amount ? parseFloat(repair_amount) : 0;
    const cogsNum = cogs ? parseFloat(cogs) : 0;
    const dpNum = dp ? parseFloat(dp) : 0;
    const { labor, bns, tech } = computeSplit(csNum, cogsNum);

    const result = db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO service_repairs
          (repair_date, repair_details, unit_model, customer_name, contact_number, technician_name,
           order_no, receipt_no, notes, cs_payment, cogs, labor_amount, bns_share, gerald_share,
           dp, repair_status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        repair_date, repair_details?.trim() || null, unit_model?.trim() || null,
        customer_name?.trim() || null, contact_number?.trim() || null, technician_name?.trim() || null,
        order_no?.trim() || null, receipt_no?.trim() || null, notes?.trim() || null,
        csNum, cogsNum, labor, bns, tech, dpNum, statusVal,
      );
      const repairId = Number(info.lastInsertRowid);
      if (dpNum > 0) {
        db.prepare(`
          INSERT INTO service_repair_payments (repair_id, amount, payment_date, payment_method, reference_notes)
          VALUES (?,?,?,?,?)
        `).run(repairId, dpNum, repair_date, 'Down Payment', 'Recorded at intake');
      }
      return repairId;
    })();

    return NextResponse.json({ id: result }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
