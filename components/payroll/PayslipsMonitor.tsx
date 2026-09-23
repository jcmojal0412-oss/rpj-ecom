'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, FileDown, Loader2, MoreVertical, Receipt, Search, Users, Wallet, FileCheck2, Coins, TriangleAlert, X,
} from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import { dailyRateOf, formatMinutesShort, isFixedRateEntry, roundOtMinutesToBlock } from '@/lib/payroll';
import { Toast, useToast } from '@/components/ui/Toast';
import Modal from '@/components/ui/Modal';
import PayslipDocument from './PayslipDocument';

// ── Types (mirror lib/payslip-monitor.ts) ────────────────────────────────
type Issue = { code: string; severity: 'error' | 'warning' | 'info'; title: string; message: string; action: 'review_attendance' | 'open_employee' | 'edit_payroll' | null };
export interface Entry {
  id: number; employee_id: number; employee_name: string; employee_code: string; position: string | null; department: string | null;
  gross_pay: number; total_deductions: number; net_pay: number;
  payment_status: string; payslip_status: string;
  paid_at: string | null; payment_date: string | null; paid_amount: number | null; payment_method: string | null; payment_reference: string | null; paid_by_name: string | null;
  payslip_released_at: string | null; payslip_first_viewed_at: string | null; payslip_last_viewed_at: string | null;
  payslip_ref: string | null;
  pay_basis?: string;
  has_email: boolean; payslip_emailed_at: string | null; payslip_emailed_to: string | null;
  payslip_email_status: 'sent' | 'delayed' | 'delivered' | 'bounced' | 'complained' | 'failed' | null; payslip_email_status_at: string | null;
  issues: Issue[]; has_issue: boolean; detail: Record<string, any>;
}
interface PeriodRef { id: number; label: string; from_date: string; to_date: string; pay_date: string | null; schedule: string | null; status: string }

// Employee payment status is about whether THAT person was paid — the run's own
// approval stages (draft / for approval / approved) are shown in the workflow.
export const PAYMENT_LABEL: Record<string, string> = { PENDING: 'Pending', PAID: 'Paid', PARTIALLY_PAID: 'Partially Paid', FAILED: 'Failed', RETURNED: 'Returned' };
export const PAYMENT_BADGE: Record<string, string> = { PENDING: 'badge-amber', PAID: 'badge-green', PARTIALLY_PAID: 'badge-amber', FAILED: 'badge-red', RETURNED: 'badge-red' };
export const PAYSLIP_LABEL: Record<string, string> = { DRAFT: 'Draft', READY: 'Ready', RELEASED: 'Released', VIEWED: 'Viewed', PRINTED: 'Printed', DOWNLOADED: 'Downloaded' };
export const PAYSLIP_BADGE: Record<string, string> = { DRAFT: 'badge-gray', READY: 'badge-blue', RELEASED: 'badge-green', VIEWED: 'badge-green', PRINTED: 'badge-green', DOWNLOADED: 'badge-green' };

const FLOW = ['Draft', 'For Approval', 'Approved', 'Paid', 'Payslips Released'];
const NEXT_ACTION = [
  'HR must review and submit payroll for approval.',
  'Waiting for Owner/Admin approval.',
  'Record payroll payment.',
  'Release employee payslips.',
  'Payroll process completed.',
];

// Stored labels end in "(Schedule B)"; the Schedule selector already says that.
const plainLabel = (l: string) => l.replace(/\s*\(Schedule [^)]*\)\s*$/i, '');

const todayPH = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

function fmtWhen(sqliteUtc: string | null) {
  if (!sqliteUtc) return '';
  const d = new Date(sqliteUtc.replace(' ', 'T') + 'Z');
  const sameYear = d.toLocaleString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric' }) === new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric' });
  return d.toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), hour: 'numeric', minute: '2-digit' });
}
const mins = (m: number) => (m > 0 ? `${Math.floor(m / 60)}h ${m % 60}m` : '0');

// Departments are typed in by hand ("SALES", "Admin", "sales"); show them all
// the same way. Short all-caps words (HR, IT) stay as they are.
function tidyDept(v: string | null): string {
  if (!v) return '';
  return v.trim().split(/\s+/).map(w => (w.length <= 3 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join(' ');
}

// Payslip email delivery. "Sent" only means the email service accepted it; the
// rest comes back from it later. No status = sent before tracking existed.
const EMAIL_LABEL: Record<string, string> = { sent: 'Sent', delivered: 'Delivered', delayed: 'Delayed', bounced: 'Bounced', complained: 'Marked spam', failed: 'Failed' };
const EMAIL_TONE: Record<string, string> = { sent: 'text-gray-400', delivered: 'text-emerald-600', delayed: 'text-amber-600', bounced: 'text-red-600', complained: 'text-red-600', failed: 'text-red-600' };
const EMAIL_HINT: Record<string, string> = {
  sent: 'Accepted by the email service. Delivery is not confirmed yet.', delivered: 'Delivered to the employee\'s inbox.',
  delayed: 'The email service is still trying to deliver it.', bounced: 'Bounced — the address is wrong or the mailbox is unavailable.',
  complained: 'The employee marked it as spam.', failed: 'The email could not be sent.',
};
function EmailTag({ e }: { e: Entry }) {
  if (!e.payslip_emailed_at) return null;
  const st = e.payslip_email_status;
  const title = `Emailed to ${e.payslip_emailed_to} · ${fmtWhen(e.payslip_emailed_at)}. ${st ? `${EMAIL_HINT[st]}${e.payslip_email_status_at ? ` (${fmtWhen(e.payslip_email_status_at)})` : ''}` : 'Sent before delivery tracking was added.'}`;
  return <span title={title} className={`text-[11px] whitespace-nowrap font-medium ${st ? EMAIL_TONE[st] : 'text-gray-400'}`}>✉ {st ? EMAIL_LABEL[st] : 'Emailed'}</span>;
}

// ── Activity: plain-language events, repeated one-per-employee rows folded ──
const GROUPED: Record<string, { one: (emp: string) => string; many: (n: number) => string }> = {
  payslip_released: { one: e => `Payslip released to ${e}`, many: n => `${n} payslips released` },
  payslip_emailed: { one: e => `Payslip emailed to ${e}`, many: n => `${n} payslips emailed` },
  payment_paid: { one: e => `Payment recorded for ${e}`, many: n => `Payment recorded for ${n} employees` },
};
const EVENT: Record<string, (emp: string) => string> = {
  generated: () => 'Payroll created', draft: () => 'Payroll created', review: () => 'Submitted for approval', for_review: () => 'Submitted for approval',
  approved: () => 'Payroll approved', paid: () => 'Payroll marked as paid', locked: () => 'Payroll locked', payslips_generated: () => 'All payslips released',
  payment_partial: e => `Partial payment recorded for ${e}`, payment_failed: e => `Payment marked failed for ${e}`, payment_returned: e => `Payment marked returned for ${e}`,
  returned: () => 'Returned to HR', reopened: () => 'Payroll reopened',
  adjustment_added: e => `Manual adjustment added for ${e}`, adjustment_removed: e => `Manual adjustment removed for ${e}`, contributions_updated: e => `Government deductions changed for ${e}`,
  attendance_refreshed: () => 'Attendance refreshed from records', voided: () => 'Payroll voided',
  entry_added: e => `${e} added to the payroll run`, entry_removed: () => 'Employee removed from the payroll run', entry_amount_changed: () => 'Fixed pay changed for this run',
  payslip_email_bounced: e => `Payslip email to ${e} bounced`, payslip_email_failed: e => `Payslip email to ${e} failed to send`,
  payslip_email_complained: e => `${e} marked the payslip email as spam`,
};
const SHOW_DETAILS = new Set(['returned', 'reopened', 'adjustment_added', 'adjustment_removed', 'contributions_updated', 'attendance_refreshed', 'payment_partial', 'payment_failed', 'payment_returned', 'payslip_email_bounced', 'payslip_email_failed', 'payslip_email_complained', 'entry_added', 'entry_removed', 'entry_amount_changed']);

function describeActivity(rows: any[]) {
  const out: { key: string; text: string; detail: string; actor: string; when: string }[] = [];
  for (let i = 0; i < rows.length; i++) {
    const a = rows[i];
    const g = GROUPED[a.action];
    if (g) {
      let n = 1;
      while (i + n < rows.length && rows[i + n].action === a.action && rows[i + n].actor_name === a.actor_name && rows[i + n].created_at.slice(0, 16) === a.created_at.slice(0, 16)) n++;
      out.push({ key: String(a.id), text: n === 1 ? g.one(a.employee_name || 'employee') : g.many(n), detail: '', actor: a.actor_name || 'System', when: fmtWhen(a.created_at) });
      i += n - 1;
      continue;
    }
    const label = EVENT[a.action]?.(a.employee_name || 'employee') ?? a.action.replace(/_/g, ' ');
    out.push({ key: String(a.id), text: label, detail: SHOW_DETAILS.has(a.action) ? a.details : '', actor: a.actor_name || 'System', when: fmtWhen(a.created_at) });
  }
  return out;
}

type Tab = 'all' | 'pending' | 'paid' | 'unreleased' | 'issues';
type Confirm =
  | { kind: 'release'; ids: number[] }
  | { kind: 'mark_paid'; ids: number[] }
  | { kind: 'pay_all' }
  | { kind: 'mark_failed' | 'mark_returned'; ids: number[] }
  | { kind: 'send_email'; ids: number[] }
  | { kind: 'submit' }
  | { kind: 'approve' }
  | { kind: 'return' }
  | { kind: 'reopen' };

const EMPTY_PAID_FORM = () => ({ amount: '', method: '', reference: '', note: '', date: todayPH() });

export default function PayslipsMonitor({ isOwner }: { isOwner: boolean }) {
  const router = useRouter();
  const { toast, showToast, clearToast } = useToast();
  const [periods, setPeriods] = useState<PeriodRef[]>([]);
  const [data, setData] = useState<any>(null);
  const [periodId, setPeriodId] = useState<number | null>(null);
  const [scheduleSel, setScheduleSel] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // One source of truth for filtering: the quick tabs, the summary cards and the
  // dropdowns all just set these three, so they can never disagree.
  const [search, setSearch] = useState('');
  const [dept, setDept] = useState('');
  const [payFilter, setPayFilter] = useState('');
  const [slipFilter, setSlipFilter] = useState('');
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [menuFor, setMenuFor] = useState<number | null>(null);
  // The dropdown is portaled to <body> and positioned by pixel coordinates
  // (not CSS `absolute` inside the table) — the table's own scroll wrapper
  // has `overflow-x-auto`, which clips any absolutely-positioned popover
  // that tries to escape it, hiding the menu for rows near the table edge.
  const [menuPos, setMenuPos] = useState<{ top?: number; bottom?: number; left: number } | null>(null);
  const MENU_WIDTH = 224; // w-56
  const openActionMenu = (id: number, btn: HTMLButtonElement) => {
    if (menuFor === id) { setMenuFor(null); setMenuPos(null); return; }
    const r = btn.getBoundingClientRect();
    const left = Math.min(Math.max(8, r.right - MENU_WIDTH), window.innerWidth - MENU_WIDTH - 8);
    const openUp = window.innerHeight - r.bottom < 260 && r.top > 260;
    setMenuPos(openUp ? { bottom: window.innerHeight - r.top + 4, left } : { top: r.bottom + 4, left });
    setMenuFor(id);
  };
  // Once open, a scroll (the table's own horizontal/vertical scroll, or the
  // page) or a resize would desync the portaled menu from its button —
  // simplest safe fix is to close it, same as clicking away.
  useEffect(() => {
    if (menuFor === null) return;
    const close = () => { setMenuFor(null); setMenuPos(null); };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, [menuFor]);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [detail, setDetail] = useState<{ entry: Entry; kind: 'details' | 'attendance' | 'issues' | 'activity' } | null>(null);
  const [viewing, setViewing] = useState<Entry | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [paidForm, setPaidForm] = useState(EMPTY_PAID_FORM());
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const [reason, setReason] = useState('');
  const [sendingSummary, setSendingSummary] = useState(false);

  const load = useCallback(async (id?: number | null) => {
    setLoading(true);
    setError('');
    try {
      const qs = id ? `?period_id=${id}` : '';
      const res = await fetch(`/api/payslips/monitor${qs}`);
      const d = await res.json();
      if (!res.ok) { setError(d.error || 'Could not load payroll.'); return; }
      setPeriods(d.periods ?? []);
      setData(d.data);
      setPeriodId(d.data?.period?.id ?? null);
      setScheduleSel(d.data?.period?.schedule ?? '');
      setSelected(new Set());
    } catch {
      setError('Could not load payroll.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(null); }, [load]);

  const entries: Entry[] = data?.entries ?? [];
  const period = data?.period;
  const summary = data?.summary;
  const periodFinal = ['approved', 'paid', 'locked'].includes(period?.status);
  const canRecordPayment = ['approved', 'paid'].includes(period?.status);
  const editable = ['draft', 'for_review'].includes(period?.status);

  // Pay Period / Schedule / Pay Date header -------------------------------------
  const scheduleValues = useMemo(() => [...new Set(periods.map(p => p.schedule ?? ''))].sort(), [periods]);
  const periodsInSchedule = periods.filter(p => (p.schedule ?? '') === scheduleSel);
  const changeSchedule = (value: string) => {
    const latest = periods.find(p => (p.schedule ?? '') === value);
    if (latest) load(latest.id);
  };

  // Filtering ---------------------------------------------------------------------
  const departments = useMemo(() => {
    const seen = new Map<string, string>();
    entries.forEach(e => { const t = tidyDept(e.department); if (t) seen.set(t.toLowerCase(), t); });
    return [...seen.values()].sort();
  }, [entries]);

  const matches = useCallback((e: Entry) => {
    // Search by employee name or by payslip Ref No. (e.g. "PS-20260915-00012" or just "00012").
    const q = search.trim().toLowerCase();
    if (q && !e.employee_name.toLowerCase().includes(q) && !(e.payslip_ref ?? '').toLowerCase().includes(q)) return false;
    if (dept && tidyDept(e.department).toLowerCase() !== dept.toLowerCase()) return false;
    if (payFilter === 'UNPAID' ? e.payment_status === 'PAID' : payFilter && e.payment_status !== payFilter) return false;
    if (slipFilter === 'NOT_RELEASED' ? e.payslip_released_at : slipFilter === 'RELEASED_ANY' ? !e.payslip_released_at : slipFilter && e.payslip_status !== slipFilter) return false;
    if (issuesOnly && !e.has_issue) return false;
    return true;
  }, [search, dept, payFilter, slipFilter, issuesOnly]);
  const shown = useMemo(() => entries.filter(matches), [entries, matches]);

  const setTab = (t: Tab) => {
    setPayFilter(t === 'pending' ? 'UNPAID' : t === 'paid' ? 'PAID' : '');
    setSlipFilter(t === 'unreleased' ? 'NOT_RELEASED' : '');
    setIssuesOnly(t === 'issues');
  };
  const activeTab: Tab | null =
    !payFilter && !slipFilter && !issuesOnly ? 'all'
    : payFilter === 'UNPAID' && !slipFilter && !issuesOnly ? 'pending'
    : payFilter === 'PAID' && !slipFilter && !issuesOnly ? 'paid'
    : slipFilter === 'NOT_RELEASED' && !payFilter && !issuesOnly ? 'unreleased'
    : issuesOnly && !payFilter && !slipFilter ? 'issues' : null;
  const tabCount = (t: Tab) => entries.filter(e =>
    t === 'all' ? true : t === 'pending' ? e.payment_status !== 'PAID' : t === 'paid' ? e.payment_status === 'PAID' : t === 'unreleased' ? !e.payslip_released_at : e.has_issue,
  ).length;

  const emptyMessage = (() => {
    if (entries.length === 0) return 'No employees are included in this payroll.';
    if (!search && !dept && activeTab === 'issues') return 'No payroll issues found for this period.';
    if (!search && !dept && activeTab === 'pending') return 'All employee payments are completed.';
    if (!search && !dept && activeTab === 'unreleased') return 'All payslips have been released.';
    if (!search && !dept && activeTab === 'paid') return 'No payments have been recorded yet.';
    return 'No employees match your filters.';
  })();

  const allShownSelected = shown.length > 0 && shown.every(e => selected.has(e.id));
  const toggleAll = () => setSelected(allShownSelected ? new Set() : new Set(shown.map(e => e.id)));
  const toggleOne = (id: number) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectedEntries = entries.filter(e => selected.has(e.id));
  const unpaidEntries = entries.filter(e => e.payment_status !== 'PAID');

  // Actions -----------------------------------------------------------------------
  const openConfirm = (c: Confirm) => { setDialogError(''); setReason(''); setPaidForm(EMPTY_PAID_FORM()); setConfirm(c); };

  const runConfirm = async () => {
    if (!confirm) return;
    setBusy(true);
    setDialogError('');
    try {
      if (confirm.kind === 'submit' || confirm.kind === 'approve') {
        const res = await fetch(`/api/payroll/periods/${period.id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: confirm.kind === 'submit' ? 'review' : 'approve' }),
        });
        const d = await res.json();
        if (!res.ok) { setDialogError(d.error || 'Could not update the payroll.'); return; }
        showToast(confirm.kind === 'submit' ? 'Payroll submitted for approval.' : 'Payroll approved.');
      } else if (confirm.kind === 'return' || confirm.kind === 'reopen') {
        const res = await fetch(`/api/payroll/periods/${period.id}/workflow`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: confirm.kind, reason }),
        });
        const d = await res.json();
        if (!res.ok) { setDialogError(d.error || 'Could not update the payroll.'); return; }
        showToast(confirm.kind === 'return' ? 'Payroll returned to HR.' : 'Payroll reopened for editing.');
      } else {
        const action = confirm.kind === 'pay_all' ? 'mark_paid' : confirm.kind;
        const ids = confirm.kind === 'pay_all' ? unpaidEntries.map(e => e.id) : confirm.ids;
        const body: any = { action, entry_ids: ids };
        if (action === 'mark_paid') {
          if (ids.length === 1 && paidForm.amount.trim()) body.amount = Number(paidForm.amount);
          body.method = paidForm.method; body.reference = paidForm.reference; body.note = paidForm.note; body.payment_date = paidForm.date;
        }
        if (action === 'mark_failed' || action === 'mark_returned') body.note = paidForm.note;
        const res = await fetch('/api/payslips/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const d = await res.json();
        if (!res.ok) { setDialogError(d.error || 'Could not save.'); return; }
        const skipped = (d.skipped ?? []) as { name: string; reason: string }[];
        const n = d.updated as number;
        const msg = action === 'release' ? `Released ${n} payslip${n === 1 ? '' : 's'}.`
          : action === 'send_email' ? `Emailed ${n} payslip${n === 1 ? '' : 's'}.`
          : action === 'mark_paid' ? `Marked ${n} employee${n === 1 ? '' : 's'} as paid.`
          : action === 'mark_failed' ? 'Payment marked as failed.' : 'Payment marked as returned.';
        showToast(`${msg}${skipped.length ? ` ${skipped.length} skipped: ${skipped[0].reason}${skipped.length > 1 ? '…' : ''}` : ''}`, n === 0 ? 'error' : 'success');
      }
      setConfirm(null);
      await load(period.id);
    } finally {
      setBusy(false);
    }
  };

  // "Send Payroll Summary" — a one-page PDF (Employee / Basic Pay / OT Pay /
  // Deductions / Net Pay + grand total) emailed to whoever handles
  // disbursement, not the employees. Manual only, any period status.
  const sendPayrollSummary = async () => {
    if (sendingSummary) return;
    setSendingSummary(true);
    try {
      const res = await fetch(`/api/payroll/periods/${period.id}/send-summary`, { method: 'POST' });
      const d = await res.json();
      if (!res.ok) { showToast(d.error || 'Could not send the payroll summary.', 'error'); return; }
      showToast(`Payroll summary sent to ${d.sent_to.join(', ')}.`);
    } catch {
      showToast('Could not reach the server. Check your connection and try again.', 'error');
    } finally {
      setSendingSummary(false);
    }
  };

  // Ask the email service whether each payslip email actually arrived.
  const checkDelivery = async (ids: number[]) => {
    if (ids.length === 0 || checking) return;
    setChecking(true);
    try {
      const res = await fetch('/api/payslips/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'check_email', entry_ids: ids }) });
      const d = await res.json();
      if (!res.ok) { showToast(d.error || 'Could not check delivery.', 'error'); return; }
      const skipped = (d.skipped ?? []) as { name: string; reason: string }[];
      const head = d.checked > 0 ? `Checked ${d.checked} email${d.checked === 1 ? '' : 's'} — ${d.updated ? `${d.updated} updated.` : 'no changes.'}` : 'Nothing could be checked.';
      showToast(`${head}${skipped.length ? ` ${skipped[0].reason}` : ''}`, d.checked === 0 ? 'error' : 'success');
      await load(period.id);
    } finally {
      setChecking(false);
    }
  };

  const allReleased = summary?.employees > 0 && summary?.released === summary?.employees;
  const statusIdx = !period ? 0
    : allReleased && ['paid', 'locked'].includes(period.status) ? 4
    : ['paid', 'locked'].includes(period.status) ? 3
    : period.status === 'approved' ? 2
    : period.status === 'for_review' ? 1 : 0;
  const partiallyPaid = summary && summary.paid > 0 && summary.paid < summary.employees;

  // Row action menu — only what applies to this payroll's current stage --------
  const menuItems = (e: Entry) => {
    const items: { label: string; onClick: () => void; danger?: boolean }[] = [
      { label: 'View Payroll Details', onClick: () => setDetail({ entry: e, kind: 'details' }) },
      { label: 'View Payslip', onClick: () => setViewing(e) },
      ...(e.pay_basis === 'fixed' ? [] : [{ label: 'View Attendance Basis', onClick: () => setDetail({ entry: e, kind: 'attendance' }) }]),
    ];
    if (editable) items.push({ label: 'Edit Payroll', onClick: () => router.push(`/payroll?period=${period.id}`) });
    if (canRecordPayment && e.payment_status !== 'PAID') items.push({ label: 'Mark as Paid', onClick: () => openConfirm({ kind: 'mark_paid', ids: [e.id] }) });
    if (periodFinal && !e.payslip_released_at) items.push({ label: 'Release Payslip', onClick: () => openConfirm({ kind: 'release', ids: [e.id] }) });
    if (periodFinal) {
      items.push({ label: 'Print / Save as PDF', onClick: () => window.open(`/payslips/${e.id}?print=1`, '_blank') });
      const undelivered = e.payslip_email_status === 'bounced' || e.payslip_email_status === 'failed';
      items.push({ label: e.has_email ? (e.payslip_emailed_at ? (undelivered ? 'Resend to Employee' : 'Send Again to Employee') : 'Send to Employee') : 'Send to Employee (no email on file)', onClick: () => e.has_email ? openConfirm({ kind: 'send_email', ids: [e.id] }) : showToast('This employee has no email address on file. Add it on their profile first.', 'error') });
    }
    if (periodFinal && e.payslip_emailed_at) items.push({ label: 'Check Email Delivery', onClick: () => checkDelivery([e.id]) });
    if (canRecordPayment && !['PAID', 'RETURNED', 'FAILED'].includes(e.payment_status)) items.push({ label: 'Mark Payment Failed', onClick: () => openConfirm({ kind: 'mark_failed', ids: [e.id] }), danger: true });
    if (canRecordPayment && ['PAID', 'PARTIALLY_PAID'].includes(e.payment_status)) items.push({ label: 'Mark Payment Returned', onClick: () => openConfirm({ kind: 'mark_returned', ids: [e.id] }), danger: true });
    items.push({ label: 'View Activity Log', onClick: () => setDetail({ entry: e, kind: 'activity' }) });
    return items;
  };

  const ActionCell = ({ e }: { e: Entry }) => (
    <div className="flex items-center justify-end gap-1.5">
      <button onClick={() => setViewing(e)} className="text-xs font-medium text-orange-600 hover:text-orange-800 px-2 py-2 md:py-1 whitespace-nowrap">View Payslip</button>
      <button onClick={(ev) => openActionMenu(e.id, ev.currentTarget)} aria-label="More actions" aria-expanded={menuFor === e.id}
        className="p-2.5 md:p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"><MoreVertical size={16} /></button>
      {menuFor === e.id && menuPos && createPortal(
        <>
          <button aria-label="Close menu" className="fixed inset-0 z-30 cursor-default" onClick={() => { setMenuFor(null); setMenuPos(null); }} />
          <div
            className="fixed z-40 w-56 bg-white rounded-xl border border-gray-200 shadow-lg py-1 max-h-[70vh] overflow-y-auto"
            style={{ left: menuPos.left, top: menuPos.top, bottom: menuPos.bottom }}
          >
            {menuItems(e).map(it => (
              <button key={it.label} onClick={() => { setMenuFor(null); setMenuPos(null); it.onClick(); }}
                className={`w-full text-left px-3.5 py-2.5 md:py-2 text-sm hover:bg-gray-50 ${it.danger ? 'text-red-600' : 'text-gray-700'}`}>{it.label}</button>
            ))}
          </div>
        </>,
        document.body
      )}
    </div>
  );

  // Warning icon: only when there is a real issue; hover shows the reason(s)
  // and the count when there are several; click explains and offers the fix.
  const IssueMark = ({ e }: { e: Entry }) => {
    const real = e.issues.filter(i => i.severity !== 'info');
    if (real.length === 0) return null;
    const tip = real.length === 1 ? `${real[0].title}: ${real[0].message}` : `${real.length} issues: ${real.map(i => i.title).join('; ')}`;
    return (
      <button onClick={() => setDetail({ entry: e, kind: 'issues' })} title={tip} aria-label={tip}
        className="inline-flex items-center gap-0.5 text-amber-500 hover:text-amber-600 p-1 -m-1 text-[11px] font-semibold">
        <TriangleAlert size={14} />{real.length > 1 ? real.length : null}
      </button>
    );
  };

  // Summary cards: every one is a shortcut to the matching filter.
  const Card = ({ icon, label, value, note, tone, onClick }: { icon: React.ReactNode; label: string; value: React.ReactNode; note?: string; tone?: 'green' | 'amber' | 'red'; onClick?: () => void }) => {
    const body = (
      <>
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">{icon}{label}</div>
        <div className={`mt-1.5 text-xl sm:text-2xl font-bold tabular-nums ${tone === 'green' ? 'text-emerald-600' : tone === 'amber' ? 'text-amber-600' : tone === 'red' ? 'text-red-600' : 'text-gray-900'}`}>{value}</div>
        <div className={`mt-0.5 text-[11px] min-h-[1rem] ${tone === 'green' ? 'text-emerald-600' : tone === 'red' ? 'text-red-500' : 'text-gray-400'}`}>{note ?? ' '}</div>
      </>
    );
    return onClick
      ? <button type="button" onClick={onClick} className="card p-3 sm:p-4 text-left w-full hover:border-orange-300 transition-colors">{body}</button>
      : <div className="card p-3 sm:p-4">{body}</div>;
  };

  const issueCount = summary?.with_issues ?? 0;
  const prev = data?.owner?.previous;

  return (
    <div className="p-3 sm:p-4 lg:p-6 space-y-4 sm:space-y-6">
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}

      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Payslips &amp; Payroll Monitoring</h1>
        <p className="text-sm text-gray-500 mt-1">Monitor payroll status, payments, payslip releases, and employee payroll records.</p>
      </div>

      {loading && !data ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin text-gray-300" size={26} /></div>
      ) : error ? (
        <div className="card text-sm text-red-600">{error}</div>
      ) : !data ? (
        <div className="card text-center py-16">
          <Receipt className="mx-auto text-gray-300 mb-3" size={32} />
          <p className="text-sm text-gray-400">No payroll has been generated yet.</p>
        </div>
      ) : (
        <>
          {/* Pay period + workflow */}
          <div className="card p-4 sm:p-5 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
              <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Pay Period</label>
                  <select className="form-input mt-1 min-w-[220px] w-full sm:w-auto font-semibold text-base sm:text-sm" value={periodId ?? ''} onChange={e => load(Number(e.target.value))}>
                    {periodsInSchedule.map(p => <option key={p.id} value={p.id}>{plainLabel(p.label)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Schedule</label>
                  <select className="form-input mt-1 w-full sm:w-auto" value={scheduleSel} onChange={e => changeSchedule(e.target.value)} disabled={scheduleValues.length <= 1}>
                    {scheduleValues.map(s => <option key={s || 'none'} value={s}>{s ? `Schedule ${s}` : 'No schedule'}</option>)}
                  </select>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Pay Date</p>
                  <p className="mt-1 py-2 text-sm font-semibold text-gray-800">{period.pay_date ? formatDate(period.pay_date) : '—'}</p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                {period.status === 'draft' && (
                  <button onClick={() => openConfirm({ kind: 'submit' })} className="btn-primary justify-center min-h-[44px] sm:min-h-0">Submit for Approval</button>
                )}
                {period.status === 'for_review' && (
                  <>
                    <button onClick={() => openConfirm({ kind: 'approve' })} className="btn-primary justify-center min-h-[44px] sm:min-h-0"><CheckCircle2 size={15} /> Approve Payroll</button>
                    <button onClick={() => openConfirm({ kind: 'return' })} className="btn-secondary justify-center min-h-[44px] sm:min-h-0">Return to HR</button>
                  </>
                )}
                {period.status === 'approved' && unpaidEntries.length > 0 && (
                  <button onClick={() => openConfirm({ kind: 'pay_all' })} className="btn-primary justify-center min-h-[44px] sm:min-h-0">Mark Payroll Paid</button>
                )}
                {period.status === 'approved' && isOwner && (
                  <button onClick={() => openConfirm({ kind: 'reopen' })} disabled={!period.can_reopen}
                    title={period.can_reopen ? 'Reopen this payroll so its amounts can be edited again' : 'Payments or released payslips already depend on this payroll'}
                    className="btn-secondary justify-center min-h-[44px] sm:min-h-0 disabled:opacity-40">Reopen Payroll</button>
                )}
                <button onClick={sendPayrollSummary} disabled={sendingSummary} title="Emails a one-page PDF (Employee, Basic Pay, OT, Deductions, Net Pay) to the payroll disbursement address — not to the employees."
                  className="btn-secondary justify-center min-h-[44px] sm:min-h-0 disabled:opacity-50">
                  {sendingSummary ? <Loader2 size={15} className="animate-spin" /> : <FileDown size={15} />} Send Payroll Summary
                </button>
                <button onClick={() => router.push(`/payroll?period=${period.id}`)} className="btn-secondary justify-center min-h-[44px] sm:min-h-0">Open Payroll Run</button>
              </div>
            </div>

            {period.status === 'draft' && period.return_reason && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm text-amber-900">
                <p className="font-semibold">{period.return_kind === 'reopened' ? 'Reopened for editing' : 'Returned to HR'}{period.returned_by_name ? ` by ${period.returned_by_name}` : ''}{period.returned_at ? ` · ${fmtWhen(period.returned_at)}` : ''}</p>
                <p className="mt-0.5 break-words">{period.return_reason}</p>
              </div>
            )}

            {/* Workflow */}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-2">Payroll Status</p>
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                {FLOW.map((step, i) => (
                  <div key={step} className="flex items-center gap-1.5 shrink-0">
                    <span className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap ${
                      i === statusIdx ? 'bg-orange-500 text-white' : i < statusIdx ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-gray-100 text-gray-400'}`}>
                      {i < statusIdx ? '✓ ' : ''}{step}
                    </span>
                    {i < FLOW.length - 1 && <span className="text-gray-300">→</span>}
                  </div>
                ))}
                {partiallyPaid && <span className="ml-2 shrink-0 badge-amber">Partially paid · {summary.paid}/{summary.employees}</span>}
                {period.status === 'locked' && <span className="ml-2 shrink-0 badge-gray">Locked</span>}
              </div>
              <p className="mt-2 text-xs text-gray-500" data-testid="next-action">
                <span className="font-semibold text-gray-700">Current Status:</span> {FLOW[statusIdx]}
                <span className="mx-2 text-gray-300">·</span>
                <span className="font-semibold text-gray-700">Next Action:</span> {NEXT_ACTION[statusIdx]}
              </p>
            </div>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Card icon={<Wallet size={13} />} label="Total Net Payroll" value={formatCurrency(summary.total_net)} />
            <Card icon={<Users size={13} />} label="Employees" value={summary.employees} onClick={() => setTab('all')} />
            <Card icon={<CheckCircle2 size={13} />} label="Paid" value={summary.paid} tone="green" onClick={() => setTab('paid')} />
            <Card icon={<Coins size={13} />} label="Pending Payment" value={summary.pending_payment} tone={summary.pending_payment > 0 ? 'amber' : undefined} onClick={() => setTab('pending')} />
            <Card icon={<FileCheck2 size={13} />} label="Payslips Released" value={`${summary.released} / ${summary.employees}`}
              onClick={() => { setPayFilter(''); setIssuesOnly(false); setSlipFilter('RELEASED_ANY'); }} />
            <Card icon={<AlertTriangle size={13} />} label="With Issues" value={issueCount} tone={issueCount > 0 ? 'red' : 'green'}
              note={issueCount > 0 ? 'Click to review' : 'No payroll issues'} onClick={() => setTab('issues')} />
          </div>

          {/* Owner summary */}
          <div className="card p-4 sm:p-5">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
              <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Payroll Summary</h2>
              <button onClick={() => setShowBreakdown(v => !v)} className="text-xs font-medium text-orange-600 hover:text-orange-800 flex items-center gap-1 py-1">
                View Payroll Breakdown {showBreakdown ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              <div><p className="text-xs text-gray-500">Total Gross Pay</p><p className="text-lg font-bold text-gray-900 tabular-nums">{formatCurrency(data.owner.gross)}</p></div>
              <div><p className="text-xs text-gray-500">Total Deductions</p><p className="text-lg font-bold text-gray-900 tabular-nums">{formatCurrency(data.owner.deductions)}</p></div>
              <div><p className="text-xs text-gray-500">Total Net Payroll</p><p className="text-lg font-bold text-gray-900 tabular-nums">{formatCurrency(data.owner.net)}</p></div>
              {prev ? (
                <>
                  <div><p className="text-xs text-gray-500">Previous Payroll</p><p className="text-lg font-bold text-gray-900 tabular-nums">{formatCurrency(prev.net)}</p><p className="text-[11px] text-gray-400 truncate" title={plainLabel(prev.label)}>{plainLabel(prev.label)}</p></div>
                  <div>
                    <p className="text-xs text-gray-500">Difference</p>
                    {prev.comparable ? (
                      <>
                        <p className={`text-lg font-bold tabular-nums ${prev.difference > 0 ? 'text-amber-600' : prev.difference < 0 ? 'text-emerald-600' : 'text-gray-900'}`}>
                          {prev.difference > 0 ? '+' : prev.difference < 0 ? '−' : ''}{formatCurrency(Math.abs(prev.difference))}
                        </p>
                        {prev.percent !== null && <p className="text-[11px] text-gray-400">{prev.percent > 0 ? '+' : ''}{prev.percent.toFixed(1)}%</p>}
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-semibold text-gray-500 pt-1">Not directly comparable</p>
                        <p className="text-[11px] text-gray-400">Previous payroll had {prev.not_comparable_reason}.</p>
                      </>
                    )}
                  </div>
                </>
              ) : (
                <div className="col-span-2"><p className="text-xs text-gray-400 pt-4">No earlier payroll to compare with.</p></div>
              )}
            </div>

            {showBreakdown && (
              <div className="mt-5 pt-5 border-t border-gray-100 grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Earnings</p>
                  {data.breakdown.earnings.map((l: any) => (
                    <div key={l.key} className="flex justify-between text-sm py-1.5 border-b border-gray-50"><span className="text-gray-600">{l.label}</span><span className="tabular-nums text-gray-900">{formatCurrency(l.amount)}</span></div>
                  ))}
                  <div className="flex justify-between text-sm font-bold pt-2"><span>Total Gross</span><span className="tabular-nums">{formatCurrency(data.breakdown.total_gross)}</span></div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Less</p>
                  {data.breakdown.deductions.filter((l: any) => l.amount > 0).map((l: any) => (
                    <div key={l.key} className="flex justify-between text-sm py-1.5 border-b border-gray-50"><span className="text-gray-600">{l.label}</span><span className="tabular-nums text-gray-900">{formatCurrency(l.amount)}</span></div>
                  ))}
                  {data.breakdown.deductions.every((l: any) => l.amount === 0) && <p className="text-sm text-gray-400 py-1.5">No deductions in this payroll.</p>}
                  <div className="flex justify-between text-sm font-bold pt-2"><span>Total Deductions</span><span className="tabular-nums">{formatCurrency(data.breakdown.total_deductions)}</span></div>
                </div>
                <div className="md:col-span-2 flex justify-between text-base font-bold pt-3 border-t border-gray-100"><span>Total Net Payroll</span><span className="tabular-nums">{formatCurrency(data.breakdown.total_net)}</span></div>
                <p className="md:col-span-2 text-[11px] text-gray-400 -mt-3">Lines are the amounts payroll already computed and stored. Tax, holiday pay and commissions are not tracked in this system, so they are not shown.</p>
              </div>
            )}
          </div>

          {/* Filters + table */}
          <div className="space-y-3">
            <div className="flex flex-col md:flex-row md:flex-wrap md:items-center gap-2">
              <div className="relative w-full md:w-64">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-300" />
                <input className="form-input pl-8 py-2 md:py-1.5 text-sm w-full" placeholder="Search employee or Ref No…" value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <select className="form-input py-2 md:py-1.5 text-sm w-full md:w-auto" value={dept} onChange={e => setDept(e.target.value)}>
                <option value="">All departments</option>{departments.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <select className="form-input py-2 md:py-1.5 text-sm w-full md:w-auto" value={payFilter} onChange={e => setPayFilter(e.target.value)}>
                <option value="">All payment statuses</option>
                <option value="UNPAID">Not fully paid</option>
                {Object.entries(PAYMENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <select className="form-input py-2 md:py-1.5 text-sm w-full md:w-auto" value={slipFilter} onChange={e => setSlipFilter(e.target.value)}>
                <option value="">All payslip statuses</option>
                <option value="NOT_RELEASED">Not released</option>
                <option value="RELEASED_ANY">Released (any)</option>
                {Object.entries(PAYSLIP_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              {issuesOnly && activeTab !== 'issues' && (
                <button onClick={() => setIssuesOnly(false)} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-red-50 text-red-700 border border-red-200">
                  With issues <X size={12} />
                </button>
              )}
            </div>

            <div className="flex gap-1.5 overflow-x-auto">
              {([['all', 'All'], ['pending', 'Pending'], ['paid', 'Paid'], ['unreleased', 'Payslip Not Released'], ['issues', 'With Issues']] as [Tab, string][]).map(([k, label]) => (
                <button key={k} onClick={() => setTab(k)}
                  className={`shrink-0 whitespace-nowrap px-3 py-2 sm:py-1.5 rounded-lg text-xs font-semibold transition-all ${activeTab === k ? 'bg-orange-500 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-100'}`}>
                  {label} <span className="opacity-70">({tabCount(k)})</span>
                </button>
              ))}
            </div>

            {selected.size > 0 && (
              <div className="card p-3 flex flex-col sm:flex-row sm:items-center gap-2 border-orange-200 bg-orange-50">
                <p className="text-sm font-semibold text-gray-800 sm:mr-2">{selected.size} employee{selected.size === 1 ? '' : 's'} selected</p>
                <div className="flex flex-wrap gap-2">
                  <button disabled={!periodFinal || selectedEntries.every(e => e.payslip_released_at)} onClick={() => openConfirm({ kind: 'release', ids: selectedEntries.filter(e => !e.payslip_released_at).map(e => e.id) })}
                    className="btn-secondary text-xs py-2.5 sm:py-1.5 disabled:opacity-40" title={periodFinal ? '' : 'Payroll must be approved first'}>Release Payslips</button>
                  <button disabled={!canRecordPayment || selectedEntries.every(e => e.payment_status === 'PAID')} onClick={() => openConfirm({ kind: 'mark_paid', ids: selectedEntries.filter(e => e.payment_status !== 'PAID').map(e => e.id) })}
                    className="btn-secondary text-xs py-2.5 sm:py-1.5 disabled:opacity-40" title={canRecordPayment ? '' : 'Payroll must be approved first'}>Mark as Paid</button>
                  <button disabled={!periodFinal} onClick={() => openConfirm({ kind: 'send_email', ids: selectedEntries.map(e => e.id) })}
                    className="btn-secondary text-xs py-2.5 sm:py-1.5 disabled:opacity-40" title={periodFinal ? '' : 'Payroll must be approved first'}>Send to Employee</button>
                  <button disabled={checking || !selectedEntries.some(e => e.payslip_emailed_at)} onClick={() => checkDelivery(selectedEntries.filter(e => e.payslip_emailed_at).map(e => e.id))}
                    className="btn-secondary text-xs py-2.5 sm:py-1.5 disabled:opacity-40" title="See whether the emailed payslips actually arrived">{checking ? 'Checking…' : 'Check Delivery'}</button>
                  <button onClick={() => window.open(`/payslips/print?ids=${selectedEntries.map(e => e.id).join(',')}&print=1`, '_blank')}
                    className="btn-secondary text-xs py-2.5 sm:py-1.5">Print / Save as PDF</button>
                  <button onClick={() => setSelected(new Set())} className="text-xs text-gray-500 hover:text-gray-800 px-2">Clear</button>
                </div>
              </div>
            )}

            <div className="card p-0 overflow-hidden">
              {shown.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-12 px-4">{emptyMessage}</p>
              ) : (
                <>
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100">
                          <th className="table-header w-10"><input type="checkbox" aria-label="Select all" checked={allShownSelected} onChange={toggleAll} className="rounded border-gray-300 text-orange-500" /></th>
                          <th className="table-header whitespace-nowrap">Employee</th>
                          <th className="table-header whitespace-nowrap text-right">Days</th>
                          <th className="table-header whitespace-nowrap text-right">Daily Rate</th>
                          <th className="table-header whitespace-nowrap text-right">OT Hours</th>
                          <th className="table-header whitespace-nowrap text-right">OT Pay</th>
                          <th className="table-header whitespace-nowrap text-right max-xl:hidden">Gross Pay</th>
                          <th className="table-header whitespace-nowrap text-right max-xl:hidden">Deductions</th>
                          <th className="table-header whitespace-nowrap text-right">Net Pay</th>
                          <th className="table-header whitespace-nowrap">Payment Status</th>
                          <th className="table-header whitespace-nowrap">Payslip Status</th>
                          <th className="table-header whitespace-nowrap text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {shown.map(e => (
                          <tr key={e.id} className={selected.has(e.id) ? 'bg-orange-50/40' : 'hover:bg-gray-50/60'}>
                            <td className="table-cell"><input type="checkbox" aria-label={`Select ${e.employee_name}`} checked={selected.has(e.id)} onChange={() => toggleOne(e.id)} className="rounded border-gray-300 text-orange-500" /></td>
                            <td className="table-cell">
                              <div className="flex items-center gap-1.5"><span className="font-medium text-gray-900">{e.employee_name}</span><IssueMark e={e} /></div>
                              <p className="text-[11px] text-gray-400">{[e.employee_code, tidyDept(e.department), e.pay_basis === 'fixed' ? 'Fixed rate' : ''].filter(Boolean).join(' · ')}</p>
                              <p className="text-[11px] text-gray-400 xl:hidden tabular-nums">Gross {formatCurrency(e.gross_pay)} · Deductions {formatCurrency(e.total_deductions)}</p>
                            </td>
                            <td className="table-cell text-right tabular-nums text-gray-600">{isFixedRateEntry(e) ? '—' : e.detail.work_days_count}</td>
                            <td className="table-cell text-right tabular-nums text-gray-600">
                              {isFixedRateEntry(e) ? <>{formatCurrency(e.detail.basic_rate)} <span className="text-gray-400">(Fixed)</span></> : formatCurrency(dailyRateOf(e.detail as any))}
                            </td>
                            <td className="table-cell text-right tabular-nums text-gray-600">{e.detail.approved_ot_minutes > 0 ? formatMinutesShort(roundOtMinutesToBlock(e.detail.approved_ot_minutes)) : '—'}</td>
                            <td className="table-cell text-right tabular-nums text-gray-600">{e.detail.ot_pay ? formatCurrency(e.detail.ot_pay) : '—'}</td>
                            <td className="table-cell text-right tabular-nums max-xl:hidden">{formatCurrency(e.gross_pay)}</td>
                            <td className="table-cell text-right tabular-nums text-gray-600 max-xl:hidden">{formatCurrency(e.total_deductions)}</td>
                            <td className={`table-cell text-right tabular-nums font-semibold ${e.net_pay < 0 ? 'text-red-600' : ''}`}>{formatCurrency(e.net_pay)}</td>
                            <td className="table-cell"><span className={PAYMENT_BADGE[e.payment_status]}>{PAYMENT_LABEL[e.payment_status]}</span></td>
                            <td className="table-cell">
                              <span className={PAYSLIP_BADGE[e.payslip_status]}>{PAYSLIP_LABEL[e.payslip_status]}</span>
                              {e.payslip_emailed_at && <span className="ml-1.5"><EmailTag e={e} /></span>}
                            </td>
                            <td className="table-cell"><ActionCell e={e} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Phone: one card per employee */}
                  <div className="md:hidden p-2.5 space-y-2.5">
                    {shown.map(e => (
                      <div key={e.id} className={`rounded-xl border p-3 ${selected.has(e.id) ? 'border-orange-300 bg-orange-50/40' : 'border-gray-200 bg-white'}`}>
                        <div className="flex items-start gap-2.5">
                          <input type="checkbox" aria-label={`Select ${e.employee_name}`} checked={selected.has(e.id)} onChange={() => toggleOne(e.id)} className="mt-1 rounded border-gray-300 text-orange-500 h-4 w-4" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5"><p className="text-sm font-semibold text-gray-900 truncate">{e.employee_name}</p><IssueMark e={e} /></div>
                            <p className="text-[11px] text-gray-400">{[e.employee_code, tidyDept(e.department)].filter(Boolean).join(' · ')}</p>
                          </div>
                          <p className={`text-base font-bold tabular-nums shrink-0 ${e.net_pay < 0 ? 'text-red-600' : 'text-gray-900'}`}>{formatCurrency(e.net_pay)}</p>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-gray-500 tabular-nums">
                          <span>Days {isFixedRateEntry(e) ? '—' : e.detail.work_days_count}</span>
                          <span>{isFixedRateEntry(e) ? <>{formatCurrency(e.detail.basic_rate)} (Fixed)</> : `${formatCurrency(dailyRateOf(e.detail as any))}/day`}</span>
                          <span>OT {e.detail.approved_ot_minutes > 0 ? formatMinutesShort(roundOtMinutesToBlock(e.detail.approved_ot_minutes)) : '—'}</span>
                          <span>OT Pay {e.detail.ot_pay ? formatCurrency(e.detail.ot_pay) : '—'}</span>
                          <span>Gross {formatCurrency(e.gross_pay)}</span><span>Deductions {formatCurrency(e.total_deductions)}</span>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className={PAYMENT_BADGE[e.payment_status]}>{PAYMENT_LABEL[e.payment_status]}</span>
                          <span className={PAYSLIP_BADGE[e.payslip_status]}>Payslip: {PAYSLIP_LABEL[e.payslip_status]}</span>
                          <EmailTag e={e} />
                        </div>
                        <div className="mt-2 pt-2 border-t border-gray-100"><ActionCell e={e} /></div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Activity — collapsed until asked for */}
          <div className="card p-4 sm:p-5">
            <button onClick={() => setShowActivity(v => !v)} className="w-full flex items-center justify-between text-sm font-semibold text-gray-900 uppercase tracking-wide">
              Activity Log {showActivity ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            {showActivity && (
              data.activity.length === 0 ? <p className="text-sm text-gray-400 mt-3">No activity recorded for this payroll yet.</p> : (
                <ul className="mt-3 divide-y divide-gray-50">
                  {describeActivity(data.activity).map(a => (
                    <li key={a.key} className="py-2.5 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm text-gray-800">{a.text} {a.actor !== 'System' && <span className="text-gray-500">by {a.actor}</span>}</p>
                        {a.detail && <p className="text-xs text-gray-500 break-words">{a.detail}</p>}
                      </div>
                      <p className="text-[11px] text-gray-400 shrink-0 text-right">{a.when}</p>
                    </li>
                  ))}
                </ul>
              )
            )}
          </div>
        </>
      )}

      {/* Payslip pop-up */}
      {viewing && (
        <Modal open onClose={() => setViewing(null)} size="xl" title={`Payslip — ${viewing.employee_name}`}>
          <PayslipViewer id={viewing.id} onClose={() => setViewing(null)} />
        </Modal>
      )}

      {/* Detail dialogs */}
      {detail && (() => {
        const real = detail.entry.issues.filter(i => i.severity !== 'info');
        const notes = detail.entry.issues.filter(i => i.severity === 'info');
        return (
          <Modal open onClose={() => setDetail(null)} size="md"
            title={detail.kind === 'details' ? `Payroll Details — ${detail.entry.employee_name}` : detail.kind === 'attendance' ? `Attendance Basis — ${detail.entry.employee_name}`
              : detail.kind === 'issues' ? (real.length > 1 ? `Payroll Issues (${real.length}) — ${detail.entry.employee_name}` : `Payroll Issue — ${detail.entry.employee_name}`) : `Activity — ${detail.entry.employee_name}`}>
            {detail.kind === 'details' && <DetailsView entry={detail.entry} />}
            {detail.kind === 'attendance' && (
              <div className="space-y-1.5 text-sm">
                {[
                  ['Days in period', `${detail.entry.detail.work_days_count}`],
                  ['Late', mins(detail.entry.detail.late_minutes)], ['Undertime', mins(detail.entry.detail.undertime_minutes)],
                  ['Excess break', mins(detail.entry.detail.excess_break_minutes)],
                  ['Absences', `${detail.entry.detail.absence_days} day(s)`], ['Unpaid leave', `${detail.entry.detail.unpaid_leave_days} day(s)`],
                  ['Approved overtime', mins(detail.entry.detail.approved_ot_minutes)],
                ].map(([k, v]) => <div key={k} className="flex justify-between py-1.5 border-b border-gray-50"><span className="text-gray-600">{k}</span><span className="font-medium tabular-nums">{v}</span></div>)}
                <p className="text-[11px] text-gray-400 pt-2">These are the attendance numbers this payroll used. If attendance was corrected afterwards, use “Refresh from Attendance” in the Payroll run (Draft / For Approval only).</p>
                <button onClick={() => router.push('/attendance')} className="btn-secondary text-xs mt-2">Review Attendance</button>
              </div>
            )}
            {detail.kind === 'issues' && (
              <div className="space-y-3">
                {real.length === 0 && <p className="text-sm text-gray-500">No payroll issues for this employee.</p>}
                {real.map(i => (
                  <div key={i.code} className={`rounded-lg border px-3.5 py-3 ${i.severity === 'error' ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
                    <p className={`text-sm font-semibold ${i.severity === 'error' ? 'text-red-800' : 'text-amber-900'}`}>{i.title}</p>
                    <p className={`text-sm mt-0.5 ${i.severity === 'error' ? 'text-red-700' : 'text-amber-800'}`}>{i.message}</p>
                    {i.action === 'review_attendance' && <button onClick={() => router.push('/attendance')} className="btn-secondary text-xs mt-2.5">Review Attendance</button>}
                    {i.action === 'open_employee' && <button onClick={() => router.push(`/employees/${detail.entry.employee_id}`)} className="btn-secondary text-xs mt-2.5">Open Employee Profile</button>}
                    {i.action === 'edit_payroll' && (editable
                      ? <button onClick={() => router.push(`/payroll?period=${period.id}`)} className="btn-secondary text-xs mt-2.5">Edit Payroll</button>
                      : <p className="text-xs mt-2 text-gray-600">Payroll is approved. Return it to HR (or reopen it) to correct this.</p>)}
                  </div>
                ))}
                {notes.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Notes</p>
                    <ul className="space-y-1">{notes.map(n => <li key={n.code} className="text-xs text-gray-600">{n.message}</li>)}</ul>
                  </div>
                )}
              </div>
            )}
            {detail.kind === 'activity' && (() => {
              const rows = describeActivity((data?.activity ?? []).filter((a: any) => a.payroll_entry_id === detail.entry.id));
              return rows.length === 0 ? <p className="text-sm text-gray-400">Nothing recorded for this employee yet.</p> : (
                <ul className="divide-y divide-gray-50">
                  {rows.map(a => (
                    <li key={a.key} className="py-2.5 flex items-start justify-between gap-3">
                      <div><p className="text-sm text-gray-800">{a.text} {a.actor !== 'System' && <span className="text-gray-500">by {a.actor}</span>}</p>{a.detail && <p className="text-xs text-gray-500">{a.detail}</p>}</div>
                      <p className="text-[11px] text-gray-400 shrink-0 text-right">{a.when}</p>
                    </li>
                  ))}
                </ul>
              );
            })()}
          </Modal>
        );
      })()}

      {/* Confirmations */}
      {confirm && data && (
        <Modal open onClose={() => !busy && setConfirm(null)} size="sm" title={
          confirm.kind === 'release' ? 'Release payslips' : confirm.kind === 'send_email' ? 'Send payslips by email' : confirm.kind === 'mark_paid' ? 'Mark as paid' : confirm.kind === 'pay_all' ? 'Mark payroll paid'
            : confirm.kind === 'mark_failed' ? 'Mark payment as failed' : confirm.kind === 'mark_returned' ? 'Mark payment as returned' : confirm.kind === 'submit' ? 'Submit for approval'
            : confirm.kind === 'return' ? 'Return to HR' : confirm.kind === 'reopen' ? 'Reopen payroll' : 'Approve payroll'}>
          <div className="space-y-4">
            {(confirm.kind === 'submit' || confirm.kind === 'approve') ? (
              <div className="text-sm text-gray-700 space-y-2">
                <p>{confirm.kind === 'submit' ? 'Submit' : 'Approve'} <b>{plainLabel(period.label)}</b> payroll{confirm.kind === 'submit' ? ' for approval' : ''}?</p>
                <div className="rounded-lg bg-gray-50 p-3 space-y-1">
                  <div className="flex justify-between"><span className="text-gray-500">Employees</span><b>{summary.employees}</b></div>
                  <div className="flex justify-between"><span className="text-gray-500">Net Payroll</span><b className="tabular-nums">{formatCurrency(summary.total_net)}</b></div>
                </div>
                {confirm.kind === 'approve' && <p className="text-xs text-gray-500">Once approved, payroll amounts are locked from normal editing.</p>}
                {summary.with_issues > 0 && <p className="text-xs rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2">{summary.with_issues} employee{summary.with_issues === 1 ? ' has' : 's have'} an issue to check. You can still continue.</p>}
              </div>
            ) : confirm.kind === 'return' || confirm.kind === 'reopen' ? (
              <div className="space-y-3">
                <p className="text-sm text-gray-700">
                  {confirm.kind === 'return'
                    ? <>Send <b>{plainLabel(period.label)}</b> back to HR for correction? It goes back to Draft.</>
                    : <>Reopen <b>{plainLabel(period.label)}</b> so its amounts can be edited again? It goes back to Draft and will need approval again.</>}
                </p>
                <div>
                  <label className="form-label">Reason *</label>
                  <textarea className="form-input" rows={3} value={reason} onChange={e => setReason(e.target.value)}
                    placeholder={confirm.kind === 'return' ? 'e.g. Incorrect attendance record for Employee X.' : 'e.g. A cash advance was missed.'} />
                </div>
              </div>
            ) : confirm.kind === 'send_email' ? (
              <div className="text-sm text-gray-700 space-y-2">
                <p>Email the payslip to <b>{confirm.ids.length}</b> employee{confirm.ids.length === 1 ? '' : 's'}? It is sent to the email address on their employee profile, and counts as released.</p>
                {(() => {
                  const noEmail = entries.filter(e => confirm.ids.includes(e.id) && !e.has_email);
                  return noEmail.length > 0 ? <p className="text-xs rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2">No email on file for: {noEmail.map(e => e.employee_name).join(', ')}. They will be skipped.</p> : null;
                })()}
                {(data.email_setup?.copy_to?.length ?? 0) > 0 && <p className="text-xs rounded-lg bg-blue-50 border border-blue-200 text-blue-800 px-3 py-2">A copy of each email is also sent to {data.email_setup.copy_to.join(', ')}.</p>}
                {data.email_setup && !data.email_setup.tracking && <p className="text-xs text-gray-500">Delivered / Bounced updates are not switched on yet, so the status stays “Sent” until you press Check Delivery.</p>}
              </div>
            ) : confirm.kind === 'release' ? (
              <div className="text-sm text-gray-700 space-y-1.5">
                <p>Release payslips to <b>{confirm.ids.length}</b> employee{confirm.ids.length === 1 ? '' : 's'}?</p>
                <p className="text-xs text-gray-500">Once released, employees will be able to view their payslips.</p>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-gray-700">
                  {confirm.kind === 'pay_all' ? 'Confirm that payroll payment has been completed?'
                    : confirm.kind === 'mark_paid' ? <>Mark <b>{confirm.ids.length}</b> employee{confirm.ids.length === 1 ? '' : 's'} as paid?</>
                    : confirm.kind === 'mark_failed' ? 'Record that this payment failed?' : 'Record that this payment was returned?'}
                </p>
                {confirm.kind === 'pay_all' && (
                  <div className="rounded-lg bg-gray-50 p-3 space-y-1 text-sm">
                    <div className="flex justify-between"><span className="text-gray-500">Employees to pay</span><b>{unpaidEntries.length}</b></div>
                    <div className="flex justify-between"><span className="text-gray-500">Total Net Payroll</span><b className="tabular-nums">{formatCurrency(unpaidEntries.reduce((s, e) => s + e.net_pay, 0))}</b></div>
                  </div>
                )}
                {confirm.kind === 'mark_paid' && confirm.ids.length === 1 && (
                  <div>
                    <label className="form-label">Amount paid now (leave blank for the full net pay)</label>
                    <input type="number" min="0" step="0.01" className="form-input" placeholder={String(entries.find(e => e.id === confirm.ids[0])?.net_pay ?? '')} value={paidForm.amount} onChange={e => setPaidForm(f => ({ ...f, amount: e.target.value }))} />
                  </div>
                )}
                {(confirm.kind === 'mark_paid' || confirm.kind === 'pay_all') && (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div><label className="form-label">Payment date</label><input type="date" max={todayPH()} className="form-input" value={paidForm.date} onChange={e => setPaidForm(f => ({ ...f, date: e.target.value }))} /></div>
                      <div><label className="form-label">Payment method (optional)</label><input className="form-input" placeholder="e.g. Bank Transfer, GCash, Cash" value={paidForm.method} onChange={e => setPaidForm(f => ({ ...f, method: e.target.value }))} /></div>
                    </div>
                    <div><label className="form-label">Reference (optional)</label><input className="form-input" value={paidForm.reference} onChange={e => setPaidForm(f => ({ ...f, reference: e.target.value }))} /></div>
                  </>
                )}
                {confirm.kind !== 'pay_all' && <div><label className="form-label">Note (optional)</label><input className="form-input" value={paidForm.note} onChange={e => setPaidForm(f => ({ ...f, note: e.target.value }))} /></div>}
              </div>
            )}
            {dialogError && <p className="text-xs text-red-600 font-medium">{dialogError}</p>}
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 [&>button]:justify-center [&>button]:py-2.5 sm:[&>button]:py-2">
              <button onClick={() => setConfirm(null)} disabled={busy} className="btn-secondary">Cancel</button>
              <button onClick={runConfirm} disabled={busy || ((confirm.kind === 'return' || confirm.kind === 'reopen') && reason.trim().length < 3)} className="btn-primary disabled:opacity-50">
                {busy ? <Loader2 size={14} className="animate-spin" /> : null}
                {confirm.kind === 'release' ? 'Release Payslips' : confirm.kind === 'send_email' ? 'Send Email' : confirm.kind === 'mark_paid' || confirm.kind === 'pay_all' ? 'Confirm Payment' : confirm.kind === 'submit' ? 'Submit for Approval'
                  : confirm.kind === 'approve' ? 'Approve Payroll' : confirm.kind === 'return' ? 'Return to HR' : confirm.kind === 'reopen' ? 'Reopen Payroll' : 'Confirm'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// "View Payroll Details": the breakdown plus the payment and payslip history for
// this one employee, so none of it has to clutter the main table.
export function DetailsView({ entry }: { entry: Entry }) {
  const d = entry.detail;
  const line = (label: string, amount: number, negative = false) => amount ? (
    <div key={label} className="flex justify-between py-1.5 border-b border-gray-50 text-sm"><span className="text-gray-600">{label}</span><span className="tabular-nums">{negative ? '−' : ''}{formatCurrency(amount)}</span></div>
  ) : null;
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between gap-4 py-1.5 border-b border-gray-50 text-sm"><span className="text-gray-600 shrink-0">{label}</span><span className="text-right font-medium text-gray-800 break-words">{value}</span></div>
  );
  const paidSomething = ['PAID', 'PARTIALLY_PAID', 'RETURNED'].includes(entry.payment_status) || !!entry.paid_at;
  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Earnings</p>
        {line('Basic Pay', d.basic_pay)}{line('Overtime Pay', d.ot_pay)}{line('Allowance', d.allowance_pay)}{line('Bonus & Other Earnings', d.bonus_earnings)}
        <div className="flex justify-between text-sm font-bold py-2"><span>Gross Pay</span><span className="tabular-nums">{formatCurrency(entry.gross_pay)}</span></div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 mt-2">Less</p>
        {line('Late', d.late_deduction, true)}{line('Undertime', d.undertime_deduction, true)}{line('Excess Break', d.excess_break_deduction, true)}
        {line('Absences', d.absence_deduction, true)}{line('Unpaid Leave', d.unpaid_leave_deduction, true)}
        {line('Cash Advance / Loan / Other', d.other_deductions, true)}
        {line('SSS', d.sss_ee, true)}{line('PhilHealth', d.philhealth_ee, true)}{line('Pag-IBIG', d.pagibig_ee, true)}
        {entry.total_deductions === 0 && <p className="text-sm text-gray-400 py-1.5">No deductions.</p>}
        <div className="flex justify-between text-sm font-bold py-2"><span>Total Deductions</span><span className="tabular-nums">{formatCurrency(entry.total_deductions)}</span></div>
        <div className="flex justify-between text-base font-bold pt-2 border-t border-gray-200"><span>Net Pay</span><span className="tabular-nums">{formatCurrency(entry.net_pay)}</span></div>
      </div>

      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Payment</p>
        {row('Payment Status', <span className={PAYMENT_BADGE[entry.payment_status]}>{PAYMENT_LABEL[entry.payment_status]}</span>)}
        {paidSomething ? (
          <>
            {row('Payment Date', entry.payment_date ? formatDate(entry.payment_date) : '—')}
            {row('Amount Paid', entry.paid_amount !== null ? formatCurrency(entry.paid_amount) : '—')}
            {row('Recorded By', entry.paid_by_name || '—')}
            {row('Payment Method', entry.payment_method || '—')}
            {row('Reference', entry.payment_reference || '—')}
          </>
        ) : <p className="text-sm text-gray-400 py-1.5">Payment has not been recorded yet.</p>}
      </div>

      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Payslip</p>
        {row('Payslip Status', <span className={PAYSLIP_BADGE[entry.payslip_status]}>{PAYSLIP_LABEL[entry.payslip_status]}</span>)}
        {entry.payslip_ref && row('Reference No.', entry.payslip_ref)}
        {row('Released', entry.payslip_released_at ? fmtWhen(entry.payslip_released_at) : 'Not yet')}
        {entry.payslip_released_at && row('First viewed by employee', entry.payslip_first_viewed_at ? fmtWhen(entry.payslip_first_viewed_at) : 'Not yet')}
        {entry.payslip_first_viewed_at && row('Last viewed by employee', fmtWhen(entry.payslip_last_viewed_at))}
        {entry.payslip_emailed_at && row('Emailed', `${fmtWhen(entry.payslip_emailed_at)} · ${entry.payslip_emailed_to}`)}
        {entry.payslip_emailed_at && row('Email delivery', entry.payslip_email_status
          ? <span className={EMAIL_TONE[entry.payslip_email_status]}>{EMAIL_LABEL[entry.payslip_email_status]}{entry.payslip_email_status_at ? ` · ${fmtWhen(entry.payslip_email_status_at)}` : ''}</span>
          : <span className="text-gray-500">Not tracked</span>)}
        {entry.payslip_emailed_at && entry.payslip_email_status === 'sent' && <p className="text-[11px] text-gray-400 py-1">“Sent” means the email service accepted it. Use Check Email Delivery to see if it arrived.</p>}
      </div>
    </div>
  );
}

// The payslip shown in a pop-up so the Payslips page never navigates away.
// It reads the same /api/payslips/[id] the full page uses (so the viewer's
// access rules and "viewed" tracking are identical) and draws the same
// document component. Printing opens the print view in a new tab, which also
// records the payslip as printed.
function PayslipViewer({ id, onClose }: { id: number; onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    fetch(`/api/payslips/${id}`).then(async r => {
      const d = await r.json();
      if (!alive) return;
      if (!r.ok) setError(d.error || 'Could not open this payslip.'); else setData(d);
    }).catch(() => alive && setError('Could not open this payslip.'));
    return () => { alive = false; };
  }, [id]);

  return (
    <div className="space-y-4">
      {error ? <p className="text-sm text-red-600">{error}</p> : !data ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-300" size={24} /></div>
      ) : (
        <div className="ps-embedded overflow-x-auto rounded-lg border border-gray-200">
          <PayslipDocument entry={data.entry} adjustments={data.adjustments} contactEmail={data.contact_email} warning={data.calc_warning} />
        </div>
      )}
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 [&>button]:justify-center [&>button]:py-2.5 sm:[&>button]:py-2">
        <button onClick={onClose} className="btn-secondary">Close</button>
        {data && <button onClick={() => window.open(`/payslips/${id}?print=1`, '_blank')} className="btn-primary">Print / Save as PDF</button>}
      </div>
    </div>
  );
}
