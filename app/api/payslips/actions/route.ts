import { NextRequest, NextResponse } from 'next/server';
import { getDb, runTransaction } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { sendEmail } from '@/lib/email';
import { buildPayslipEmail, isValidEmail } from '@/lib/payslip-email';

export const dynamic = 'force-dynamic';

type Action = 'release' | 'send_email' | 'mark_paid' | 'mark_failed' | 'mark_returned';
const ACTIONS: Action[] = ['release', 'send_email', 'mark_paid', 'mark_failed', 'mark_returned'];

interface Row {
  id: number; payroll_period_id: number; employee_name_snapshot: string; net_pay: number;
  payment_status: string | null; paid_amount: number | null; payslip_released_at: string | null;
  period_status: string; voided_at: string | null;
}

const peso = (n: number) => `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Per-employee payslip release / email and payment recording, single or bulk. These
// only ever write the new payment_* / payslip_* columns (and the audit log) —
// no payroll amount is recalculated or edited here. Owner or Payroll
// permission only.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('payroll')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const action = body.action as Action;
    if (!ACTIONS.includes(action)) return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    const ids: number[] = Array.isArray(body.entry_ids) ? [...new Set<number>(body.entry_ids.map(Number).filter((n: number) => Number.isInteger(n) && n > 0))] : [];
    if (ids.length === 0) return NextResponse.json({ error: 'Select at least one employee.' }, { status: 400 });
    if (ids.length > 500) return NextResponse.json({ error: 'Too many employees in one action.' }, { status: 400 });

    const method = String(body.method ?? '').trim().slice(0, 60) || null;
    const reference = String(body.reference ?? '').trim().slice(0, 120) || null;
    const note = String(body.note ?? '').trim().slice(0, 300) || null;

    const db = getDb();
    const rows = db.prepare(`
      SELECT e.id, e.payroll_period_id, e.employee_name_snapshot, e.net_pay, e.payment_status, e.paid_amount, e.payslip_released_at,
             p.status AS period_status, p.voided_at
      FROM payroll_entries e JOIN payroll_periods p ON p.id = e.payroll_period_id
      WHERE e.id IN (${ids.map(() => '?').join(',')})
    `).all(...ids) as Row[];
    if (rows.length !== ids.length) return NextResponse.json({ error: 'Some of the selected payroll records no longer exist.' }, { status: 404 });
    const periodIds = new Set(rows.map(r => r.payroll_period_id));
    if (periodIds.size !== 1) return NextResponse.json({ error: 'Select employees from one pay period at a time.' }, { status: 400 });
    const periodId = rows[0].payroll_period_id;
    const periodStatus = rows[0].period_status;
    if (rows[0].voided_at) return NextResponse.json({ error: 'This payroll period was voided.' }, { status: 409 });

    if ((action === 'release' || action === 'send_email') && !['approved', 'paid', 'locked'].includes(periodStatus)) {
      return NextResponse.json({ error: `Payroll must be approved before payslips can be ${action === 'release' ? 'released' : 'sent'}.` }, { status: 409 });
    }
    if (action !== 'release' && action !== 'send_email' && !['approved', 'paid'].includes(periodStatus)) {
      return NextResponse.json({
        error: periodStatus === 'locked'
          ? 'This payroll is locked — payments can no longer be changed.'
          : 'Payroll must be approved before payments can be recorded.',
      }, { status: 409 });
    }

    // Send to Employee: e-mail each person their own payslip at the address on
    // their employee record. Sending also counts as releasing it (it is now in
    // their hands), but only after the e-mail actually went out, so a failed
    // send changes nothing. Done one at a time (network calls), not in the
    // single transaction the other actions use.
    if (action === 'send_email') {
      if (ids.length > 100) return NextResponse.json({ error: 'Send to at most 100 employees at a time.' }, { status: 400 });
      const period = db.prepare('SELECT label, from_date, to_date, pay_date FROM payroll_periods WHERE id = ?').get(periodId) as
        { label: string; from_date: string; to_date: string; pay_date: string | null };
      const getEntry = db.prepare('SELECT * FROM payroll_entries WHERE id = ?');
      const getAdj = db.prepare('SELECT adjustment_type, amount, reason FROM payroll_adjustments WHERE payroll_entry_id = ? ORDER BY created_at ASC');
      const getEmail = db.prepare('SELECT email FROM employees WHERE id = ?');
      const audit2 = db.prepare(`INSERT INTO payroll_audit_log (payroll_period_id, payroll_entry_id, actor_user_id, action, details) VALUES (?, ?, ?, ?, ?)`);
      let sent = 0;
      const notSent: { id: number; name: string; reason: string }[] = [];

      for (const r of rows) {
        const entry = getEntry.get(r.id) as Record<string, any>;
        const address = ((getEmail.get(entry.employee_id) as { email: string | null } | undefined)?.email ?? '').trim();
        if (!isValidEmail(address)) { notSent.push({ id: r.id, name: r.employee_name_snapshot, reason: 'No email address on file' }); continue; }

        const { subject, html } = buildPayslipEmail(entry, getAdj.all(r.id) as any[], period);
        const result = await sendEmail(address, subject, html, undefined, 'RPJ Corporation');
        if (!result.sent) {
          notSent.push({ id: r.id, name: r.employee_name_snapshot, reason: 'error' in result && result.error ? 'The email could not be sent' : 'Email sending is not set up yet' });
          continue;
        }
        runTransaction(() => {
          if (!r.payslip_released_at) {
            db.prepare(`UPDATE payroll_entries SET payslip_released_at = datetime('now'), payslip_released_by = ? WHERE id = ?`).run(session.id, r.id);
            audit2.run(periodId, r.id, session.id, 'payslip_released', `Payslip released to ${r.employee_name_snapshot} (when emailed)`);
          }
          db.prepare(`UPDATE payroll_entries SET payslip_emailed_at = datetime('now'), payslip_emailed_to = ? WHERE id = ?`).run(address, r.id);
          audit2.run(periodId, r.id, session.id, 'payslip_emailed', `Payslip emailed to ${r.employee_name_snapshot} (${address})`);
        });
        sent++;
      }

      const totals2 = db.prepare(`SELECT COUNT(*) n, SUM(CASE WHEN payslip_released_at IS NOT NULL THEN 1 ELSE 0 END) released FROM payroll_entries WHERE payroll_period_id = ?`).get(periodId) as { n: number; released: number };
      if (totals2.n > 0 && totals2.released === totals2.n) {
        db.prepare(`UPDATE payroll_periods SET payslips_generated_by = COALESCE(payslips_generated_by, ?), payslips_generated_at = COALESCE(payslips_generated_at, datetime('now')) WHERE id = ?`).run(session.id, periodId);
      }
      return NextResponse.json({ ok: true, updated: sent, skipped: notSent });
    }

    // A custom amount only makes sense for one person at a time; a bulk
    // "Mark as Paid" always pays each employee's remaining net pay.
    let customAmount: number | null = null;
    if (action === 'mark_paid' && body.amount !== undefined && body.amount !== null && body.amount !== '') {
      if (ids.length !== 1) return NextResponse.json({ error: 'A custom amount can only be recorded for one employee at a time.' }, { status: 400 });
      customAmount = Number(body.amount);
      if (!Number.isFinite(customAmount) || customAmount <= 0) return NextResponse.json({ error: 'Amount must be more than 0.' }, { status: 400 });
    }

    const skipped: { id: number; name: string; reason: string }[] = [];
    let updated = 0;

    const audit = db.prepare(`
      INSERT INTO payroll_audit_log (payroll_period_id, payroll_entry_id, actor_user_id, action, details) VALUES (?, ?, ?, ?, ?)
    `);

    runTransaction(() => {
      for (const r of rows) {
        const name = r.employee_name_snapshot;

        if (action === 'release') {
          if (r.payslip_released_at) { skipped.push({ id: r.id, name, reason: 'Already released' }); continue; }
          db.prepare(`UPDATE payroll_entries SET payslip_released_at = datetime('now'), payslip_released_by = ? WHERE id = ?`).run(session.id, r.id);
          audit.run(periodId, r.id, session.id, 'payslip_released', `Payslip released to ${name}`);
          updated++;
          continue;
        }

        if (action === 'mark_paid') {
          if (r.payment_status === 'PAID' || (periodStatus === 'paid' && r.payment_status === null)) { skipped.push({ id: r.id, name, reason: 'Already paid' }); continue; }
          const already = r.payment_status === 'PARTIALLY_PAID' ? (r.paid_amount ?? 0) : 0;
          const pay = customAmount ?? Math.max(0, r.net_pay - already);
          const total = already + pay;
          if (total > r.net_pay + 0.005) { skipped.push({ id: r.id, name, reason: `Amount is more than the net pay (${peso(r.net_pay)})` }); continue; }
          const full = total >= r.net_pay - 0.005;
          db.prepare(`
            UPDATE payroll_entries SET payment_status = ?, paid_amount = ?, paid_at = datetime('now'), paid_by = ?,
              payment_method = COALESCE(?, payment_method), payment_reference = COALESCE(?, payment_reference), payment_note = COALESCE(?, payment_note)
            WHERE id = ?
          `).run(full ? 'PAID' : 'PARTIALLY_PAID', full ? r.net_pay : total, session.id, method, reference, note, r.id);
          audit.run(periodId, r.id, session.id, full ? 'payment_paid' : 'payment_partial',
            `${name}: ${full ? 'paid in full' : `partial payment ${peso(pay)} (${peso(total)} of ${peso(r.net_pay)})`}${method ? ` via ${method}` : ''}${reference ? ` ref ${reference}` : ''}`);
          updated++;
          continue;
        }

        if (action === 'mark_failed') {
          if (r.payment_status === 'PAID' || (periodStatus === 'paid' && r.payment_status === null)) { skipped.push({ id: r.id, name, reason: 'Already paid — use Returned if the money came back' }); continue; }
          db.prepare(`UPDATE payroll_entries SET payment_status = 'FAILED', payment_note = COALESCE(?, payment_note) WHERE id = ?`).run(note, r.id);
          audit.run(periodId, r.id, session.id, 'payment_failed', `${name}: payment failed${note ? ` — ${note}` : ''}`);
          updated++;
          continue;
        }

        // mark_returned: the money was paid and then came back
        const wasPaid = r.payment_status === 'PAID' || r.payment_status === 'PARTIALLY_PAID' || (periodStatus === 'paid' && r.payment_status === null);
        if (!wasPaid) { skipped.push({ id: r.id, name, reason: 'Nothing was paid yet, so nothing can be returned' }); continue; }
        db.prepare(`UPDATE payroll_entries SET payment_status = 'RETURNED', payment_note = COALESCE(?, payment_note) WHERE id = ?`).run(note, r.id);
        audit.run(periodId, r.id, session.id, 'payment_returned', `${name}: payment returned${note ? ` — ${note}` : ''}`);
        updated++;
      }

      // Keep the period-level markers the Payroll wizard reads in step: every
      // payslip released => payslips_generated_at; every employee paid while
      // the period is still 'approved' => the period itself becomes 'paid'.
      const totals = db.prepare(`
        SELECT COUNT(*) n,
               SUM(CASE WHEN payslip_released_at IS NOT NULL THEN 1 ELSE 0 END) released,
               SUM(CASE WHEN payment_status = 'PAID' THEN 1 ELSE 0 END) paid
        FROM payroll_entries WHERE payroll_period_id = ?
      `).get(periodId) as { n: number; released: number; paid: number };
      if (totals.n > 0 && totals.released === totals.n) {
        db.prepare(`UPDATE payroll_periods SET payslips_generated_by = COALESCE(payslips_generated_by, ?), payslips_generated_at = COALESCE(payslips_generated_at, datetime('now')) WHERE id = ?`).run(session.id, periodId);
      }
      if (totals.n > 0 && totals.paid === totals.n && periodStatus === 'approved') {
        db.prepare(`UPDATE payroll_periods SET status = 'paid', paid_by = ?, paid_at = datetime('now') WHERE id = ? AND status = 'approved'`).run(session.id, periodId);
        db.prepare(`INSERT INTO payroll_audit_log (payroll_period_id, actor_user_id, action, details) VALUES (?, ?, 'paid', 'Every employee has been paid — payroll marked as Paid')`).run(periodId, session.id);
      }
    });

    return NextResponse.json({ ok: true, updated, skipped });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
