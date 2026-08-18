import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { computeSplit, deriveCustomerPaymentStatus, deriveTechPayoutStatus, REPAIR_STATUSES, type RepairStatus } from '@/lib/service-center';

export const dynamic = 'force-dynamic';

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getDb();
    const row = db.prepare(`SELECT * FROM service_repairs WHERE id = ?`).get(params.id) as any;
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const payments = db.prepare(`
      SELECT id, amount, payment_date, payment_method, reference_notes, created_at
      FROM service_repair_payments WHERE repair_id = ? ORDER BY payment_date DESC, id DESC
    `).all(params.id);
    const payouts = db.prepare(`
      SELECT t.id, t.amount, t.payment_date, t.payment_method, t.reference_notes, t.processed_by, t.created_at,
             u.name as processed_by_name
      FROM service_repair_tech_payouts t
      LEFT JOIN users u ON u.id = t.processed_by
      WHERE t.repair_id = ? ORDER BY t.payment_date DESC, t.id DESC
    `).all(params.id);

    const collected = (payments as { amount: number }[]).reduce((s, p) => s + p.amount, 0);
    const paidOut = (payouts as { amount: number }[]).reduce((s, p) => s + p.amount, 0);

    return NextResponse.json({
      id: row.id, repair_date: row.repair_date, repair_details: row.repair_details, unit_model: row.unit_model,
      customer_name: row.customer_name, contact_number: row.contact_number, technician_name: row.technician_name,
      order_no: row.order_no, receipt_no: row.receipt_no, notes: row.notes,
      repair_amount: row.cs_payment, cogs: row.cogs, labor_amount: row.labor_amount,
      bns_share: row.bns_share, tech_earnings: row.gerald_share,
      repair_status: row.repair_status,
      collected, balance: Math.max(0, row.cs_payment - collected),
      customer_payment_status: deriveCustomerPaymentStatus(collected, row.cs_payment),
      paid_out: paidOut, tech_payable: Math.max(0, row.gerald_share - paidOut),
      tech_payout_status: deriveTechPayoutStatus(paidOut, row.gerald_share, row.repair_status),
      created_at: row.created_at,
      payments, payouts,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getDb();
    const {
      repair_date, repair_details, unit_model, customer_name, contact_number, technician_name,
      order_no, receipt_no, notes, repair_amount, cogs, repair_status,
    } = await req.json();

    const csNum = repair_amount ? parseFloat(repair_amount) : 0;
    const cogsNum = cogs ? parseFloat(cogs) : 0;
    const { labor, bns, tech } = computeSplit(csNum, cogsNum);
    const statusVal: RepairStatus | null = REPAIR_STATUSES.includes(repair_status) ? repair_status : null;

    const info = db.prepare(`
      UPDATE service_repairs SET
        repair_date=?, repair_details=?, unit_model=?, customer_name=?, contact_number=?, technician_name=?,
        order_no=?, receipt_no=?, notes=?, cs_payment=?, cogs=?, labor_amount=?, bns_share=?, gerald_share=?,
        repair_status=COALESCE(?, repair_status)
      WHERE id=?
    `).run(
      repair_date, repair_details?.trim() || null, unit_model?.trim() || null,
      customer_name?.trim() || null, contact_number?.trim() || null, technician_name?.trim() || null,
      order_no?.trim() || null, receipt_no?.trim() || null, notes?.trim() || null,
      csNum, cogsNum, labor, bns, tech,
      statusVal,
      params.id,
    );

    if (info.changes === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getDb();
    db.prepare('DELETE FROM service_repairs WHERE id=?').run(params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
