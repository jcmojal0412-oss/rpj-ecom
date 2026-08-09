import { NextRequest, NextResponse } from 'next/server';
import { getDb, runTransaction } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { recomputePayrollEntry } from '@/lib/payroll-data';

export const dynamic = 'force-dynamic';

function requireAdmin(session: Awaited<ReturnType<typeof getSession>>) {
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.role !== 'owner' && !session.permissions.includes('payroll')) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }
  return null;
}

const FIELDS = ['sss_ee', 'sss_er', 'sss_ec', 'philhealth_ee', 'philhealth_er', 'pagibig_ee', 'pagibig_er'] as const;

// Statutory Contributions are entered MANUALLY, per payroll run — HR types
// the exact SSS/PhilHealth/Pag-IBIG peso amounts (both shares) themselves
// in Review Payroll, rather than the engine auto-computing them (see
// app/api/payroll/periods/route.ts's generate step, which now seeds every
// entry's statutory columns at ₱0). This route is the only way those
// columns ever change after generation. Blocked once the period is locked,
// same rule as adjustments.
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  const denied = requireAdmin(session);
  if (denied) return denied;

  try {
    const body = await req.json();
    const values: Record<string, number> = {};
    for (const f of FIELDS) {
      const n = Number(body[f]);
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json({ error: `${f} must be a non-negative number` }, { status: 400 });
      }
      values[f] = n;
    }

    const db = getDb();
    const entry = db.prepare(`
      SELECT e.id, e.payroll_period_id, p.status FROM payroll_entries e
      JOIN payroll_periods p ON p.id = e.payroll_period_id WHERE e.id = ?
    `).get(params.id) as { id: number; payroll_period_id: number; status: string } | undefined;
    if (!entry) return NextResponse.json({ error: 'Payroll entry not found' }, { status: 404 });
    if (entry.status === 'locked') return NextResponse.json({ error: 'This payroll period is locked and can no longer be edited.' }, { status: 409 });

    runTransaction(() => {
      db.prepare(`
        UPDATE payroll_entries SET
          sss_ee_contribution=?, sss_er_contribution=?, sss_ec_contribution=?, sss_version_snapshot='manual',
          philhealth_ee_contribution=?, philhealth_er_contribution=?, philhealth_version_snapshot='manual',
          pagibig_ee_contribution=?, pagibig_er_contribution=?, pagibig_version_snapshot='manual'
        WHERE id=?
      `).run(
        values.sss_ee, values.sss_er, values.sss_ec,
        values.philhealth_ee, values.philhealth_er,
        values.pagibig_ee, values.pagibig_er,
        entry.id
      );

      recomputePayrollEntry(db, entry.id);

      db.prepare(`
        INSERT INTO payroll_audit_log (payroll_period_id, payroll_entry_id, actor_user_id, action, details)
        VALUES (?, ?, ?, 'contributions_updated', ?)
      `).run(entry.payroll_period_id, entry.id, session!.id,
        `SSS EE ₱${values.sss_ee}/ER ₱${values.sss_er}/EC ₱${values.sss_ec}, PhilHealth EE ₱${values.philhealth_ee}/ER ₱${values.philhealth_er}, Pag-IBIG EE ₱${values.pagibig_ee}/ER ₱${values.pagibig_er}`
      );
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
