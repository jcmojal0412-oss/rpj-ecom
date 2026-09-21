'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Loader2, MoreVertical, Receipt, Search, Users, Wallet, FileCheck2, Coins, TriangleAlert,
} from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Toast, useToast } from '@/components/ui/Toast';
import Modal from '@/components/ui/Modal';
import PayslipDocument from './PayslipDocument';

// ── Types (mirror lib/payslip-monitor.ts) ────────────────────────────────
type Issue = { code: string; severity: 'error' | 'warning' | 'info'; message: string };
interface Entry {
  id: number; employee_id: number; employee_name: string; employee_code: string; position: string | null; department: string | null;
  gross_pay: number; total_deductions: number; net_pay: number;
  payment_status: string; payslip_status: string;
  paid_at: string | null; paid_amount: number | null; payment_method: string | null; payment_reference: string | null;
  payslip_released_at: string | null; has_email: boolean; payslip_emailed_at: string | null; payslip_emailed_to: string | null;
  issues: Issue[]; has_issue: boolean; detail: Record<string, any>;
}
interface PeriodRef { id: number; label: string; from_date: string; to_date: string; pay_date: string | null; schedule: string | null; status: string }

const PERIOD_STATUS_LABEL: Record<string, string> = { draft: 'Draft', for_review: 'For Approval', approved: 'Approved', paid: 'Paid', locked: 'Locked' };
const PAYMENT_LABEL: Record<string, string> = {
  PENDING: 'Pending', FOR_APPROVAL: 'For Approval', APPROVED: 'Approved', PAID: 'Paid', PARTIALLY_PAID: 'Partially Paid', FAILED: 'Failed', RETURNED: 'Returned',
};
const PAYMENT_BADGE: Record<string, string> = {
  PENDING: 'badge-gray', FOR_APPROVAL: 'badge-amber', APPROVED: 'badge-blue', PAID: 'badge-green', PARTIALLY_PAID: 'badge-amber', FAILED: 'badge-red', RETURNED: 'badge-red',
};
const PAYSLIP_LABEL: Record<string, string> = {
  DRAFT: 'Draft', READY: 'Ready', RELEASED: 'Released', VIEWED: 'Viewed', PRINTED: 'Printed', DOWNLOADED: 'Downloaded',
};
const PAYSLIP_BADGE: Record<string, string> = {
  DRAFT: 'badge-gray', READY: 'badge-blue', RELEASED: 'badge-green', VIEWED: 'badge-green', PRINTED: 'badge-green', DOWNLOADED: 'badge-green',
};
const ACTION_LABEL: Record<string, string> = {
  draft: 'Payroll prepared', review: 'Submitted for approval', for_review: 'Submitted for approval', approved: 'Payroll approved', paid: 'Marked as paid', locked: 'Payroll locked',
  generated: 'Payroll prepared', payslips_generated: 'Payslips released', payslip_released: 'Payslip released',
  payment_paid: 'Payment recorded', payment_partial: 'Partial payment recorded', payment_failed: 'Payment marked failed', payment_returned: 'Payment marked returned',
  attendance_refreshed: 'Attendance refreshed', voided: 'Payroll voided',
  returned: 'Returned to HR', reopened: 'Payroll reopened', payslip_emailed: 'Payslip emailed',
};

const FLOW = ['Draft', 'For Approval', 'Approved', 'Paid', 'Payslips Released'];

function fmtWhen(sqliteUtc: string | null) {
  if (!sqliteUtc) return '';
  const d = new Date(sqliteUtc.replace(' ', 'T') + 'Z');
  return d.toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}
const mins = (m: number) => (m > 0 ? `${Math.floor(m / 60)}h ${m % 60}m` : '0');

type QuickTab = 'all' | 'pending' | 'paid' | 'unreleased' | 'issues';
type Confirm =
  | { kind: 'release'; ids: number[] }
  | { kind: 'mark_paid'; ids: number[] }
  | { kind: 'mark_failed' | 'mark_returned'; ids: number[] }
  | { kind: 'send_email'; ids: number[] }
  | { kind: 'submit' }
  | { kind: 'approve' }
  | { kind: 'return' }
  | { kind: 'reopen' };

export default function PayslipsMonitor({ isOwner }: { isOwner: boolean }) {
  const router = useRouter();
  const { toast, showToast, clearToast } = useToast();
  const [periods, setPeriods] = useState<PeriodRef[]>([]);
  const [data, setData] = useState<any>(null);
  const [periodId, setPeriodId] = useState<number | null>(null);
  const [scheduleFilter, setScheduleFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [dept, setDept] = useState('');
  const [payFilter, setPayFilter] = useState('');
  const [slipFilter, setSlipFilter] = useState('');
  const [tab, setTab] = useState<QuickTab>('all');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [detail, setDetail] = useState<{ entry: Entry; kind: 'breakdown' | 'attendance' | 'issues' | 'activity' } | null>(null);
  const [viewing, setViewing] = useState<Entry | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [paidForm, setPaidForm] = useState({ amount: '', method: '', reference: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const [reason, setReason] = useState('');

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

  const visiblePeriods = periods.filter(p => !scheduleFilter || p.schedule === scheduleFilter);
  const departments = useMemo(() => [...new Set(entries.map(e => e.department).filter(Boolean) as string[])].sort(), [entries]);

  const shown = useMemo(() => entries.filter(e => {
    if (search && !e.employee_name.toLowerCase().includes(search.toLowerCase())) return false;
    if (dept && e.department !== dept) return false;
    if (payFilter && e.payment_status !== payFilter) return false;
    if (slipFilter && e.payslip_status !== slipFilter) return false;
    if (tab === 'pending' && e.payment_status === 'PAID') return false;
    if (tab === 'paid' && e.payment_status !== 'PAID') return false;
    if (tab === 'unreleased' && e.payslip_released_at) return false;
    if (tab === 'issues' && !e.has_issue) return false;
    return true;
  }), [entries, search, dept, payFilter, slipFilter, tab]);

  const tabCount = (t: QuickTab) => entries.filter(e =>
    t === 'all' ? true : t === 'pending' ? e.payment_status !== 'PAID' : t === 'paid' ? e.payment_status === 'PAID' : t === 'unreleased' ? !e.payslip_released_at : e.has_issue,
  ).length;

  const allShownSelected = shown.length > 0 && shown.every(e => selected.has(e.id));
  const toggleAll = () => setSelected(allShownSelected ? new Set() : new Set(shown.map(e => e.id)));
  const toggleOne = (id: number) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectedEntries = entries.filter(e => selected.has(e.id));

  // ── Actions ────────────────────────────────────────────────────────────
  const openConfirm = (c: Confirm) => { setDialogError(''); setReason(''); setPaidForm({ amount: '', method: '', reference: '', note: '' }); setConfirm(c); };

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
        const body: any = { action: confirm.kind, entry_ids: confirm.ids };
        if (confirm.kind === 'mark_paid') {
          if (confirm.ids.length === 1 && paidForm.amount.trim()) body.amount = Number(paidForm.amount);
          body.method = paidForm.method; body.reference = paidForm.reference; body.note = paidForm.note;
        }
        if (confirm.kind === 'mark_failed' || confirm.kind === 'mark_returned') body.note = paidForm.note;
        const res = await fetch('/api/payslips/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const d = await res.json();
        if (!res.ok) { setDialogError(d.error || 'Could not save.'); return; }
        const skipped = (d.skipped ?? []) as { name: string; reason: string }[];
        const n = d.updated as number;
        const msg = confirm.kind === 'release' ? `Released ${n} payslip${n === 1 ? '' : 's'}.`
          : confirm.kind === 'send_email' ? `Emailed ${n} payslip${n === 1 ? '' : 's'}.`
          : confirm.kind === 'mark_paid' ? `Marked ${n} employee${n === 1 ? '' : 's'} as paid.`
          : confirm.kind === 'mark_failed' ? 'Payment marked as failed.' : 'Payment marked as returned.';
        showToast(`${msg}${skipped.length ? ` ${skipped.length} skipped: ${skipped[0].reason}${skipped.length > 1 ? '…' : ''}` : ''}`, n === 0 ? 'error' : 'success');
      }
      setConfirm(null);
      await load(period.id);
    } finally {
      setBusy(false);
    }
  };

  const statusIdx = !period ? 0
    : summary?.released === summary?.employees && summary?.employees > 0 && ['paid', 'locked'].includes(period.status) ? 4
    : ['paid', 'locked'].includes(period.status) ? 3
    : period.status === 'approved' ? 2
    : period.status === 'for_review' ? 1 : 0;
  const partiallyPaid = summary && summary.paid > 0 && summary.paid < summary.employees;

  // ── Row action menu ────────────────────────────────────────────────────
  const menuItems = (e: Entry) => {
    const items: { label: string; onClick: () => void; danger?: boolean }[] = [
      { label: 'View Payslip', onClick: () => setViewing(e) },
    ];
    if (['draft', 'for_review'].includes(period.status)) items.push({ label: 'Edit Payroll', onClick: () => router.push(`/payroll?period=${period.id}`) });
    items.push({ label: 'View Payroll Breakdown', onClick: () => setDetail({ entry: e, kind: 'breakdown' }) });
    items.push({ label: 'View Attendance Basis', onClick: () => setDetail({ entry: e, kind: 'attendance' }) });
    if (canRecordPayment && e.payment_status !== 'PAID') items.push({ label: 'Mark as Paid', onClick: () => openConfirm({ kind: 'mark_paid', ids: [e.id] }) });
    if (periodFinal && !e.payslip_released_at) items.push({ label: 'Release Payslip', onClick: () => openConfirm({ kind: 'release', ids: [e.id] }) });
    items.push({ label: 'Print Payslip', onClick: () => window.open(`/payslips/${e.id}?print=1`, '_blank') });
    if (periodFinal) items.push({ label: e.has_email ? (e.payslip_emailed_at ? 'Send Again to Employee' : 'Send to Employee') : 'Send to Employee (no email on file)', onClick: () => e.has_email ? openConfirm({ kind: 'send_email', ids: [e.id] }) : showToast('This employee has no email address on file. Add it on their profile first.', 'error') });
    if (canRecordPayment && !['PAID', 'RETURNED'].includes(e.payment_status) && e.payment_status !== 'FAILED') items.push({ label: 'Mark Payment Failed', onClick: () => openConfirm({ kind: 'mark_failed', ids: [e.id] }), danger: true });
    if (canRecordPayment && ['PAID', 'PARTIALLY_PAID'].includes(e.payment_status)) items.push({ label: 'Mark Payment Returned', onClick: () => openConfirm({ kind: 'mark_returned', ids: [e.id] }), danger: true });
    items.push({ label: 'View Activity Log', onClick: () => setDetail({ entry: e, kind: 'activity' }) });
    return items;
  };

  const ActionCell = ({ e }: { e: Entry }) => (
    <div className="relative flex items-center justify-end gap-1.5">
      <button onClick={() => setViewing(e)} className="text-xs font-medium text-orange-600 hover:text-orange-800 px-2 py-2 md:py-1">View Payslip</button>
      <button onClick={() => setMenuFor(menuFor === e.id ? null : e.id)} aria-label="More actions"
        className="p-2.5 md:p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"><MoreVertical size={16} /></button>
      {menuFor === e.id && (
        <>
          <button aria-label="Close menu" className="fixed inset-0 z-30 cursor-default" onClick={() => setMenuFor(null)} />
          <div className="absolute right-0 top-full mt-1 z-40 w-56 bg-white rounded-xl border border-gray-200 shadow-lg py-1">
            {menuItems(e).map(it => (
              <button key={it.label} onClick={() => { setMenuFor(null); it.onClick(); }}
                className={`w-full text-left px-3.5 py-2.5 md:py-2 text-sm hover:bg-gray-50 ${it.danger ? 'text-red-600' : 'text-gray-700'}`}>{it.label}</button>
            ))}
          </div>
        </>
      )}
    </div>
  );

  const IssueMark = ({ e }: { e: Entry }) => e.has_issue ? (
    <button onClick={() => setDetail({ entry: e, kind: 'issues' })} title="This payroll record has something to check"
      className="inline-flex items-center text-amber-500 hover:text-amber-600 p-1 -m-1"><TriangleAlert size={14} /></button>
  ) : null;

  // ── Render ─────────────────────────────────────────────────────────────
  const Card = ({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: React.ReactNode; tone?: 'green' | 'amber' | 'red' | 'blue' }) => (
    <div className="card p-3 sm:p-4">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">{icon}{label}</div>
      <div className={`mt-1.5 text-xl sm:text-2xl font-bold tabular-nums ${tone === 'green' ? 'text-emerald-600' : tone === 'amber' ? 'text-amber-600' : tone === 'red' ? 'text-red-600' : 'text-gray-900'}`}>{value}</div>
    </div>
  );

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
                  <select className="form-input mt-1 min-w-[240px] w-full sm:w-auto font-semibold text-base sm:text-sm" value={periodId ?? ''} onChange={e => load(Number(e.target.value))}>
                    {visiblePeriods.map(p => <option key={p.id} value={p.id}>{p.label}{p.schedule ? ` · Schedule ${p.schedule}` : ''}</option>)}
                    {periodId && !visiblePeriods.some(p => p.id === periodId) && <option value={periodId}>{period.label}</option>}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Schedule</label>
                  <select className="form-input mt-1 w-full sm:w-auto" value={scheduleFilter} onChange={e => setScheduleFilter(e.target.value)}>
                    <option value="">All schedules</option><option value="A">Schedule A</option><option value="B">Schedule B</option>
                  </select>
                </div>
                <div className="text-sm text-gray-600 pb-0.5">
                  {period.schedule && <span className="font-medium text-gray-800">Schedule {period.schedule}</span>}
                  {period.pay_date && <span className="block sm:inline sm:ml-3">Pay Date: <span className="font-medium text-gray-800">{formatDate(period.pay_date)}</span></span>}
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
                {period.status === 'approved' && isOwner && (
                  <button onClick={() => openConfirm({ kind: 'reopen' })} disabled={!period.can_reopen}
                    title={period.can_reopen ? 'Reopen this payroll so its amounts can be edited again' : 'Payments or released payslips already depend on this payroll'}
                    className="btn-secondary justify-center min-h-[44px] sm:min-h-0 disabled:opacity-40">Reopen Payroll</button>
                )}
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
            </div>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Card icon={<Wallet size={13} />} label="Total Net Payroll" value={formatCurrency(summary.total_net)} />
            <Card icon={<Users size={13} />} label="Employees" value={summary.employees} />
            <Card icon={<CheckCircle2 size={13} />} label="Paid" value={summary.paid} tone="green" />
            <Card icon={<Coins size={13} />} label="Pending Payment" value={summary.pending_payment} tone={summary.pending_payment > 0 ? 'amber' : undefined} />
            <Card icon={<FileCheck2 size={13} />} label="Payslips Released" value={`${summary.released} / ${summary.employees}`} />
            <Card icon={<AlertTriangle size={13} />} label="With Issues" value={summary.with_issues} tone={summary.with_issues > 0 ? 'red' : undefined} />
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
              {data.owner.previous ? (
                <>
                  <div><p className="text-xs text-gray-500">Previous Payroll</p><p className="text-lg font-bold text-gray-900 tabular-nums">{formatCurrency(data.owner.previous.net)}</p><p className="text-[11px] text-gray-400 truncate">{data.owner.previous.label}</p></div>
                  <div>
                    <p className="text-xs text-gray-500">Difference</p>
                    <p className={`text-lg font-bold tabular-nums ${data.owner.previous.difference > 0 ? 'text-amber-600' : data.owner.previous.difference < 0 ? 'text-emerald-600' : 'text-gray-900'}`}>
                      {data.owner.previous.difference > 0 ? '+' : data.owner.previous.difference < 0 ? '−' : ''}{formatCurrency(Math.abs(data.owner.previous.difference))}
                    </p>
                    {data.owner.previous.percent !== null && (
                      <p className="text-[11px] text-gray-400">{data.owner.previous.percent > 0 ? '+' : ''}{data.owner.previous.percent.toFixed(1)}%</p>
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
            <div className="flex flex-col md:flex-row md:items-center gap-2">
              <div className="relative w-full md:w-64">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-300" />
                <input className="form-input pl-8 py-2 md:py-1.5 text-sm w-full" placeholder="Search employee…" value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <select className="form-input py-2 md:py-1.5 text-sm w-full md:w-auto" value={dept} onChange={e => setDept(e.target.value)}>
                <option value="">All departments</option>{departments.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <select className="form-input py-2 md:py-1.5 text-sm w-full md:w-auto" value={payFilter} onChange={e => setPayFilter(e.target.value)}>
                <option value="">All payment statuses</option>{Object.entries(PAYMENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <select className="form-input py-2 md:py-1.5 text-sm w-full md:w-auto" value={slipFilter} onChange={e => setSlipFilter(e.target.value)}>
                <option value="">All payslip statuses</option>{Object.entries(PAYSLIP_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>

            <div className="flex gap-1.5 overflow-x-auto">
              {([['all', 'All'], ['pending', 'Pending'], ['paid', 'Paid'], ['unreleased', 'Payslip Not Released'], ['issues', 'With Issues']] as [QuickTab, string][]).map(([k, label]) => (
                <button key={k} onClick={() => setTab(k)}
                  className={`shrink-0 whitespace-nowrap px-3 py-2 sm:py-1.5 rounded-lg text-xs font-semibold transition-all ${tab === k ? 'bg-orange-500 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-100'}`}>
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
                  <button onClick={() => window.open(`/payslips/print?ids=${selectedEntries.map(e => e.id).join(',')}&print=1`, '_blank')}
                    className="btn-secondary text-xs py-2.5 sm:py-1.5">Print / Save as PDF</button>
                  <button onClick={() => setSelected(new Set())} className="text-xs text-gray-500 hover:text-gray-800 px-2">Clear</button>
                </div>
              </div>
            )}

            <div className="card p-0 overflow-hidden">
              {shown.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-12">No employees match these filters.</p>
              ) : (
                <>
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100">
                          <th className="table-header w-10"><input type="checkbox" aria-label="Select all" checked={allShownSelected} onChange={toggleAll} className="rounded border-gray-300 text-orange-500" /></th>
                          {['Employee', 'Gross Pay', 'Deductions', 'Net Pay', 'Payment Status', 'Payslip Status', 'Action'].map(h => (
                            <th key={h} className={`table-header whitespace-nowrap ${['Gross Pay', 'Deductions', 'Net Pay', 'Action'].includes(h) ? 'text-right' : ''}`}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {shown.map(e => (
                          <tr key={e.id} className={selected.has(e.id) ? 'bg-orange-50/40' : 'hover:bg-gray-50/60'}>
                            <td className="table-cell"><input type="checkbox" aria-label={`Select ${e.employee_name}`} checked={selected.has(e.id)} onChange={() => toggleOne(e.id)} className="rounded border-gray-300 text-orange-500" /></td>
                            <td className="table-cell">
                              <div className="flex items-center gap-1.5"><span className="font-medium text-gray-900">{e.employee_name}</span><IssueMark e={e} /></div>
                              <p className="text-[11px] text-gray-400">{[e.employee_code, e.department].filter(Boolean).join(' · ')}</p>
                            </td>
                            <td className="table-cell text-right tabular-nums">{formatCurrency(e.gross_pay)}</td>
                            <td className="table-cell text-right tabular-nums text-gray-600">{formatCurrency(e.total_deductions)}</td>
                            <td className={`table-cell text-right tabular-nums font-semibold ${e.net_pay < 0 ? 'text-red-600' : ''}`}>{formatCurrency(e.net_pay)}</td>
                            <td className="table-cell"><span className={PAYMENT_BADGE[e.payment_status]}>{PAYMENT_LABEL[e.payment_status]}</span></td>
                            <td className="table-cell">
                              <span className={PAYSLIP_BADGE[e.payslip_status]}>{PAYSLIP_LABEL[e.payslip_status]}</span>
                              {e.payslip_emailed_at && <span title={`Emailed to ${e.payslip_emailed_to} · ${fmtWhen(e.payslip_emailed_at)}`} className="ml-1.5 text-[11px] text-gray-400">✉ Emailed</span>}
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
                            <p className="text-[11px] text-gray-400">{[e.employee_code, e.department].filter(Boolean).join(' · ')}</p>
                          </div>
                          <p className={`text-base font-bold tabular-nums shrink-0 ${e.net_pay < 0 ? 'text-red-600' : 'text-gray-900'}`}>{formatCurrency(e.net_pay)}</p>
                        </div>
                        <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
                          <span>Gross {formatCurrency(e.gross_pay)}</span><span>Deductions {formatCurrency(e.total_deductions)}</span>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className={PAYMENT_BADGE[e.payment_status]}>{PAYMENT_LABEL[e.payment_status]}</span>
                          <span className={PAYSLIP_BADGE[e.payslip_status]}>Payslip: {PAYSLIP_LABEL[e.payslip_status]}</span>
                          {e.payslip_emailed_at && <span className="text-[11px] text-gray-400">✉ Emailed</span>}
                        </div>
                        <div className="mt-2 pt-2 border-t border-gray-100"><ActionCell e={e} /></div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Activity */}
          <div className="card p-4 sm:p-5">
            <button onClick={() => setShowActivity(v => !v)} className="w-full flex items-center justify-between text-sm font-semibold text-gray-900 uppercase tracking-wide">
              Activity Log {showActivity ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            {showActivity && (
              data.activity.length === 0 ? <p className="text-sm text-gray-400 mt-3">No activity recorded for this payroll yet.</p> : (
                <ul className="mt-3 divide-y divide-gray-50">
                  {data.activity.map((a: any) => (
                    <li key={a.id} className="py-2.5 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm text-gray-800">{ACTION_LABEL[a.action] ?? a.action}{a.employee_name ? ` — ${a.employee_name}` : ''}</p>
                        <p className="text-xs text-gray-500 break-words">{a.details}</p>
                      </div>
                      <div className="text-right shrink-0"><p className="text-xs font-medium text-gray-700">{a.actor_name || 'System'}</p><p className="text-[11px] text-gray-400">{fmtWhen(a.created_at)}</p></div>
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
      {detail && (
        <Modal open onClose={() => setDetail(null)} size="sm"
          title={detail.kind === 'breakdown' ? `Payroll Breakdown — ${detail.entry.employee_name}` : detail.kind === 'attendance' ? `Attendance Basis — ${detail.entry.employee_name}` : detail.kind === 'issues' ? `Things to Check — ${detail.entry.employee_name}` : `Activity — ${detail.entry.employee_name}`}>
          {detail.kind === 'breakdown' && <BreakdownView entry={detail.entry} />}
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
              <button onClick={() => router.push('/attendance')} className="btn-secondary text-xs mt-2">Open Attendance</button>
            </div>
          )}
          {detail.kind === 'issues' && (
            <ul className="space-y-2">
              {detail.entry.issues.map(i => (
                <li key={i.code} className={`text-sm rounded-lg px-3 py-2.5 border ${i.severity === 'error' ? 'bg-red-50 border-red-200 text-red-800' : i.severity === 'warning' ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-gray-50 border-gray-200 text-gray-600'}`}>{i.message}</li>
              ))}
            </ul>
          )}
          {detail.kind === 'activity' && (() => {
            const rows = (data?.activity ?? []).filter((a: any) => a.payroll_entry_id === detail.entry.id);
            return rows.length === 0 ? <p className="text-sm text-gray-400">Nothing recorded for this employee yet.</p> : (
              <ul className="divide-y divide-gray-50">
                {rows.map((a: any) => (
                  <li key={a.id} className="py-2.5 flex items-start justify-between gap-3">
                    <div><p className="text-sm text-gray-800">{ACTION_LABEL[a.action] ?? a.action}</p><p className="text-xs text-gray-500">{a.details}</p></div>
                    <div className="text-right shrink-0"><p className="text-xs font-medium text-gray-700">{a.actor_name || 'System'}</p><p className="text-[11px] text-gray-400">{fmtWhen(a.created_at)}</p></div>
                  </li>
                ))}
              </ul>
            );
          })()}
        </Modal>
      )}

      {/* Confirmations */}
      {confirm && data && (
        <Modal open onClose={() => !busy && setConfirm(null)} size="sm" title={
          confirm.kind === 'release' ? 'Release payslips' : confirm.kind === 'send_email' ? 'Send payslips by email' : confirm.kind === 'mark_paid' ? 'Mark as paid' : confirm.kind === 'mark_failed' ? 'Mark payment as failed'
            : confirm.kind === 'mark_returned' ? 'Mark payment as returned' : confirm.kind === 'submit' ? 'Submit for approval' : confirm.kind === 'return' ? 'Return to HR'
            : confirm.kind === 'reopen' ? 'Reopen payroll' : 'Approve payroll'}>
          <div className="space-y-4">
            {(confirm.kind === 'submit' || confirm.kind === 'approve') ? (
              <div className="text-sm text-gray-700 space-y-2">
                <p>{confirm.kind === 'submit' ? 'Submit' : 'Approve'} payroll for <b>{period.label}</b>?</p>
                <div className="rounded-lg bg-gray-50 p-3 space-y-1">
                  <div className="flex justify-between"><span className="text-gray-500">Employees</span><b>{summary.employees}</b></div>
                  <div className="flex justify-between"><span className="text-gray-500">Total Net Payroll</span><b className="tabular-nums">{formatCurrency(summary.total_net)}</b></div>
                </div>
                {confirm.kind === 'approve' && <p className="text-xs text-gray-500">Once approved, payroll amounts are locked from normal editing.</p>}
                {summary.with_issues > 0 && <p className="text-xs rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2">{summary.with_issues} employee{summary.with_issues === 1 ? ' has' : 's have'} something to check. You can still continue.</p>}
              </div>
            ) : confirm.kind === 'return' || confirm.kind === 'reopen' ? (
              <div className="space-y-3">
                <p className="text-sm text-gray-700">
                  {confirm.kind === 'return'
                    ? <>Send <b>{period.label}</b> back to HR for correction? It goes back to Draft.</>
                    : <>Reopen <b>{period.label}</b> so its amounts can be edited again? It goes back to Draft and will need approval again.</>}
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
              </div>
            ) : confirm.kind === 'release' ? (
              <p className="text-sm text-gray-700">Release payslips for <b>{confirm.ids.length}</b> employee{confirm.ids.length === 1 ? '' : 's'}? They will be able to see them right away.</p>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-gray-700">
                  {confirm.kind === 'mark_paid' ? <>Mark <b>{confirm.ids.length}</b> employee{confirm.ids.length === 1 ? '' : 's'} as paid?</>
                    : confirm.kind === 'mark_failed' ? 'Record that this payment failed?' : 'Record that this payment was returned?'}
                </p>
                {confirm.kind === 'mark_paid' && confirm.ids.length === 1 && (
                  <div>
                    <label className="form-label">Amount paid now (leave blank for the full net pay)</label>
                    <input type="number" min="0" step="0.01" className="form-input" placeholder={String(entries.find(e => e.id === confirm.ids[0])?.net_pay ?? '')} value={paidForm.amount} onChange={e => setPaidForm(f => ({ ...f, amount: e.target.value }))} />
                  </div>
                )}
                {confirm.kind === 'mark_paid' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div><label className="form-label">Payment method</label><input className="form-input" placeholder="e.g. GCash, Cash, Bank" value={paidForm.method} onChange={e => setPaidForm(f => ({ ...f, method: e.target.value }))} /></div>
                    <div><label className="form-label">Reference no.</label><input className="form-input" value={paidForm.reference} onChange={e => setPaidForm(f => ({ ...f, reference: e.target.value }))} /></div>
                  </div>
                )}
                <div><label className="form-label">Note (optional)</label><input className="form-input" value={paidForm.note} onChange={e => setPaidForm(f => ({ ...f, note: e.target.value }))} /></div>
              </div>
            )}
            {dialogError && <p className="text-xs text-red-600 font-medium">{dialogError}</p>}
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 [&>button]:justify-center [&>button]:py-2.5 sm:[&>button]:py-2">
              <button onClick={() => setConfirm(null)} disabled={busy} className="btn-secondary">Cancel</button>
              <button onClick={runConfirm} disabled={busy || ((confirm.kind === 'return' || confirm.kind === 'reopen') && reason.trim().length < 3)} className="btn-primary disabled:opacity-50">
                {busy ? <Loader2 size={14} className="animate-spin" /> : null}
                {confirm.kind === 'release' ? 'Confirm Release' : confirm.kind === 'send_email' ? 'Send Email' : confirm.kind === 'mark_paid' ? 'Confirm Payment' : confirm.kind === 'submit' ? 'Submit' : confirm.kind === 'approve' ? 'Approve Payroll' : confirm.kind === 'return' ? 'Return to HR' : confirm.kind === 'reopen' ? 'Reopen Payroll' : 'Confirm'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function BreakdownView({ entry }: { entry: Entry }) {
  const d = entry.detail;
  const line = (label: string, amount: number, negative = false) => amount ? (
    <div key={label} className="flex justify-between py-1.5 border-b border-gray-50 text-sm"><span className="text-gray-600">{label}</span><span className="tabular-nums">{negative ? '−' : ''}{formatCurrency(amount)}</span></div>
  ) : null;
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Earnings</p>
      {line('Basic Pay', d.basic_pay)}{line('Overtime Pay', d.ot_pay)}{line('Allowance', d.allowance_pay)}{line('Bonus & Other Earnings', d.bonus_earnings)}
      <div className="flex justify-between text-sm font-bold py-2"><span>Gross Pay</span><span className="tabular-nums">{formatCurrency(entry.gross_pay)}</span></div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 mt-2">Less</p>
      {line('Late', d.late_deduction, true)}{line('Undertime', d.undertime_deduction, true)}{line('Excess Break', d.excess_break_deduction, true)}
      {line('Absences', d.absence_deduction, true)}{line('Unpaid Leave', d.unpaid_leave_deduction, true)}
      {line('Cash Advance / Loan / Other', d.other_deductions, true)}
      {line('SSS', d.sss_ee, true)}{line('PhilHealth', d.philhealth_ee, true)}{line('Pag-IBIG', d.pagibig_ee, true)}
      <div className="flex justify-between text-sm font-bold py-2"><span>Total Deductions</span><span className="tabular-nums">{formatCurrency(entry.total_deductions)}</span></div>
      <div className="flex justify-between text-base font-bold pt-2 border-t border-gray-200"><span>Net Pay</span><span className="tabular-nums">{formatCurrency(entry.net_pay)}</span></div>
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
          <PayslipDocument entry={data.entry} adjustments={data.adjustments} />
        </div>
      )}
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 [&>button]:justify-center [&>button]:py-2.5 sm:[&>button]:py-2">
        <button onClick={onClose} className="btn-secondary">Close</button>
        {data && <button onClick={() => window.open(`/payslips/${id}?print=1`, '_blank')} className="btn-primary">Print / Save as PDF</button>}
      </div>
    </div>
  );
}
