import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { sendEmail } from '@/lib/email';
import { payPeriodText, payslipCopyRecipients } from '@/lib/payslip-email';
import { buildPayrollSummaryPdf, type SummaryRow } from '@/lib/payroll-summary-pdf';

export const dynamic = 'force-dynamic';

// "Send Payroll Summary" — a one-page PDF (Employee, Basic Pay, OT Pay,
// Deductions, Net Pay + grand total) for whoever handles disbursement, not
// the employees themselves. Manual, one click at a time; never automatic.
// Recipient is PAYSLIP_BCC_EMAIL (the same address already copied on every
// individual payslip email) — owner/payroll only, same permission bar as
// every other payslip action.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('payroll')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Payroll period not found' }, { status: 404 });

  try {
    const db = getDb();
    const period = db.prepare('SELECT id, label, from_date, to_date, pay_date, schedule, voided_at FROM payroll_periods WHERE id = ?').get(id) as
      { id: number; label: string; from_date: string; to_date: string; pay_date: string | null; schedule: string | null; voided_at: string | null } | undefined;
    if (!period) return NextResponse.json({ error: 'Payroll period not found' }, { status: 404 });
    if (period.voided_at) return NextResponse.json({ error: 'This payroll period was voided.' }, { status: 409 });

    const to = payslipCopyRecipients();
    if (to.length === 0) return NextResponse.json({ error: 'No payroll recipient is configured (PAYSLIP_BCC_EMAIL is not set).' }, { status: 409 });

    const rows = db.prepare(`
      SELECT employee_name_snapshot, employee_code_snapshot, basic_pay, ot_pay, total_deductions, net_pay
      FROM payroll_entries WHERE payroll_period_id = ? ORDER BY employee_name_snapshot ASC
    `).all(id) as SummaryRow[];
    if (rows.length === 0) return NextResponse.json({ error: 'This payroll run has no employees yet.' }, { status: 409 });

    const pdf = await buildPayrollSummaryPdf(period, rows, session.name);
    const periodText = payPeriodText(period.from_date, period.to_date);
    const totalNet = rows.reduce((s, r) => s + r.net_pay, 0);
    const html = `
      <p>Hi,</p>
      <p>Attached is the payroll summary for <strong>${periodText}</strong>${period.schedule ? ` (Schedule ${period.schedule})` : ''} —
        ${rows.length} employee${rows.length === 1 ? '' : 's'}, total net pay <strong>₱${totalNet.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>.</p>
      <p>Pay date: ${period.pay_date ?? '—'}.</p>
      <p>Sent from RPJ Management System by ${session.name}.</p>
    `;
    const filename = `Payroll-Summary-${period.from_date}-to-${period.to_date}.pdf`;
    const result = await sendEmail(to[0], `Payroll Summary — ${periodText}`, html, undefined, 'RPJ Corporation', undefined, to.slice(1), [{ filename, content: pdf }]);
    if (!result.sent) return NextResponse.json({ error: 'error' in result && result.error ? 'The email could not be sent.' : 'Email sending is not set up yet.' }, { status: 502 });

    db.prepare(`INSERT INTO payroll_audit_log (payroll_period_id, actor_user_id, action, details) VALUES (?, ?, 'summary_sent', ?)`)
      .run(id, session.id, `Payroll summary PDF (${rows.length} employees) sent to ${to.join(', ')}`);

    return NextResponse.json({ ok: true, sent_to: to, employees: rows.length });
  } catch (e) {
    console.error('[payroll summary]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
