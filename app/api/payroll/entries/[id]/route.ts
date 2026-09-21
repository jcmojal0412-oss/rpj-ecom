import { NextRequest, NextResponse } from 'next/server';
import { getDb, runTransaction } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { recomputePayrollEntry } from '@/lib/payroll-data';
import { payrollEditBlockedMessage } from '@/lib/payroll-lock';

export const dynamic = 'force-dynamic';

// Full breakdown for the "click an employee" drill-down in Step 3 — reads
// ONLY the frozen snapshot columns on payroll_entries, never a live join
// back to employees/attendance_events, so this always reflects what was
// true at generation time even if the employee's salary/shift/attendance
// changes afterward.
export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('payroll')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const db = getDb();
  const entry = db.prepare(`
    SELECT e.*, p.status as period_status, p.label as period_label, p.from_date, p.to_date
    FROM payroll_entries e JOIN payroll_periods p ON p.id = e.payroll_period_id
    WHERE e.id = ?
  `).get(params.id);
  if (!entry) return NextResponse.json({ error: 'Payroll entry not found' }, { status: 404 });

  const adjustments = db.prepare(`
    SELECT a.*, u.name as added_by_name FROM payroll_adjustments a
    LEFT JOIN users u ON u.id = a.added_by
    WHERE a.payroll_entry_id = ? ORDER BY a.created_at ASC
  `).all(params.id);

  return NextResponse.json({ entry, adjustments });
}

// ---- editing a payroll entry while its run is still being prepared ----

function loadEditable(db: ReturnType<typeof getDb>, id: string) {
  const entry = db.prepare(`
    SELECT e.*, p.status AS period_status, p.voided_at FROM payroll_entries e JOIN payroll_periods p ON p.id = e.payroll_period_id WHERE e.id = ?
  `).get(id) as any;
  if (!entry || entry.voided_at) return { error: NextResponse.json({ error: 'Payroll entry not found' }, { status: 404 }) };
  const blocked = payrollEditBlockedMessage(entry.period_status);
  if (blocked) return { error: NextResponse.json({ error: blocked }, { status: 409 }) };
  return { entry };
}

async function authorize() {
  const session = await getSession();
  if (!session) return { error: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) };
  if (session.role !== 'owner' && !session.permissions.includes('payroll')) return { error: NextResponse.json({ error: 'Not authorized' }, { status: 403 }) };
  return { session };
}

// Set (or clear, with null) the Basic Pay for THIS run of a fixed-rate entry.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorize();
  if (auth.error) return auth.error;
  try {
    const body = await req.json();
    const db = getDb();
    const loaded = loadEditable(db, params.id);
    if (loaded.error) return loaded.error;
    const entry = loaded.entry;
    if (entry.pay_basis_snapshot !== 'fixed') return NextResponse.json({ error: 'Only a fixed-rate employee has a custom amount. Others are paid from attendance.' }, { status: 400 });

    let amount: number | null = null;
    if (body.amount !== null && body.amount !== undefined && body.amount !== '') {
      amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) return NextResponse.json({ error: 'Amount must be more than ₱0.' }, { status: 400 });
      amount = Math.round(amount * 100) / 100;
    }
    runTransaction(() => {
      db.prepare('UPDATE payroll_entries SET basic_pay_override = ? WHERE id = ?').run(amount, entry.id);
      recomputePayrollEntry(db, entry.id);
      db.prepare(`INSERT INTO payroll_audit_log (payroll_period_id, payroll_entry_id, actor_user_id, action, details) VALUES (?, ?, ?, 'entry_amount_changed', ?)`)
        .run(entry.payroll_period_id, entry.id, auth.session!.id, amount === null ? `${entry.employee_name_snapshot}: pay set back to the fixed rate` : `${entry.employee_name_snapshot}: pay for this run set to ₱${amount.toFixed(2)}`);
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// Take someone out of a run that is still being prepared. Refused once a
// payslip was released / emailed or a payment was recorded, and never after approval.
export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorize();
  if (auth.error) return auth.error;
  try {
    const db = getDb();
    const loaded = loadEditable(db, params.id);
    if (loaded.error) return loaded.error;
    const entry = loaded.entry;
    if (entry.payslip_released_at || entry.payslip_emailed_at || entry.payment_status) {
      return NextResponse.json({ error: 'A payslip was already released or a payment recorded for this employee, so they can no longer be removed.' }, { status: 409 });
    }
    runTransaction(() => {
      // The history stays; it just no longer points at a record that is gone.
      db.prepare('UPDATE payroll_audit_log SET payroll_entry_id = NULL WHERE payroll_entry_id = ?').run(entry.id);
      db.prepare('DELETE FROM payroll_adjustments WHERE payroll_entry_id = ?').run(entry.id);
      db.prepare('DELETE FROM payroll_entries WHERE id = ?').run(entry.id);
      db.prepare(`INSERT INTO payroll_audit_log (payroll_period_id, payroll_entry_id, actor_user_id, action, details) VALUES (?, NULL, ?, 'entry_removed', ?)`)
        .run(entry.payroll_period_id, auth.session!.id, `${entry.employee_name_snapshot} removed from this payroll run (net pay was ₱${Number(entry.net_pay).toFixed(2)})`);
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
