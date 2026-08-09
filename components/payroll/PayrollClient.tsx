'use client';

import { useEffect, useState } from 'react';
import { Loader2, ChevronLeft, ChevronRight, CheckCircle2, AlertTriangle, ArrowLeft, Plus, Trash2, Archive } from 'lucide-react';
import { formatCurrency, formatDate, todayISO } from '@/lib/utils';
import { Toast, useToast } from '@/components/ui/Toast';
import Modal from '@/components/ui/Modal';
import { getDefaultCutoffs, type AdjustmentType } from '@/lib/payroll';

export const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', for_review: 'For Review', approved: 'Approved', paid: 'Paid', locked: 'Locked',
};
export const STATUS_BADGE: Record<string, string> = {
  draft: 'badge-gray', for_review: 'badge-amber', approved: 'badge-blue', paid: 'badge-green', locked: 'badge-green',
};

// Which wizard step to resume a period at, based on its current status.
// (Step 1 "Select Period" and Step 2 "Generate Payroll" only ever apply
// BEFORE a period exists — resuming an already-generated draft jumps
// straight to Step 3 "Check Issues".)
const RESUME_STEP: Record<string, number> = { draft: 3, for_review: 5, approved: 5, paid: 5, locked: 5 };

const ADJUSTMENT_LABELS: Record<AdjustmentType, string> = {
  bonus: 'Bonus', incentive: 'Incentive', additional_allowance: 'Additional Allowance', other_earning: 'Other Earning',
  cash_advance: 'Cash Advance', loan_deduction: 'Loan Deduction', other_deduction: 'Other Deduction',
};
const EARNING_TYPES: AdjustmentType[] = ['bonus', 'incentive', 'additional_allowance', 'other_earning'];

export default function PayrollClient() {
  const { toast, showToast, clearToast } = useToast();
  const [periods, setPeriods] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'list' | 'wizard'>('list');
  const [activePeriodId, setActivePeriodId] = useState<number | null>(null);
  const [initialStep, setInitialStep] = useState(1);
  // Only bumps when the wizard should actually reset (opening a different
  // period from the list, or starting fresh) — NOT on every activePeriodId
  // change. Generation itself calls setActivePeriodId(id) too (see
  // onGenerated below); keying off that directly used to force a full
  // remount at the exact moment generation succeeded, wiping out the
  // in-progress wizard's own setStep(3) and dropping the user back to
  // Step 1 right after a successful "Generate Payroll".
  const [wizardKey, setWizardKey] = useState(0);

  const fetchPeriods = () => {
    setLoading(true);
    fetch('/api/payroll/periods').then(r => r.json()).then(d => { setPeriods(Array.isArray(d) ? d : []); setLoading(false); });
  };
  useEffect(fetchPeriods, []);

  const openPeriod = (period: any) => {
    setActivePeriodId(period.id);
    setInitialStep(RESUME_STEP[period.status] ?? 2);
    setView('wizard');
    setWizardKey(k => k + 1);
  };

  const startNew = () => {
    setActivePeriodId(null);
    setInitialStep(1);
    setView('wizard');
    setWizardKey(k => k + 1);
  };

  const backToList = () => {
    setActivePeriodId(null);
    setView('list');
    fetchPeriods();
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}

      {view === 'list' ? (
        <>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Payroll</h1>
            <p className="text-sm text-gray-500 mt-1">Simple, guided payroll — one period at a time.</p>
          </div>
          <PeriodList periods={periods} loading={loading} onOpen={openPeriod} onStartNew={startNew} onRefresh={fetchPeriods} showToast={showToast} />
        </>
      ) : (
        <PayrollWizard
          key={wizardKey}
          periodId={activePeriodId}
          initialStep={initialStep}
          onBackToList={backToList}
          onGenerated={(id) => setActivePeriodId(id)}
          showToast={showToast}
        />
      )}
    </div>
  );
}

function PeriodList({ periods, loading, onOpen, onStartNew, onRefresh, showToast }: { periods: any[]; loading: boolean; onOpen: (p: any) => void; onStartNew: () => void; onRefresh: () => void; showToast: (m: string, t?: 'success' | 'error') => void }) {
  const [voidingId, setVoidingId] = useState<number | null>(null);

  // Void (soft delete) — owner/'payroll' permission only (already the gate
  // for this whole page). Never removes data: payroll_entries, adjustments,
  // and the audit log all stay intact, so this is safe to offer without
  // undermining the Lock/immutability guarantees elsewhere in this module.
  // Allowed even after payslips have been generated (explicitly requested,
  // despite an employee possibly having already seen theirs) — the confirm()
  // below is the only safety net for that case, so its wording escalates
  // specifically when payslips_generated_at is set. Don't soften either.
  const voidPeriod = async (e: React.MouseEvent, p: any) => {
    e.stopPropagation();
    const warning = p.payslips_generated_at
      ? `Void "${p.label}"? Payslips have already been generated for this period — employees may have already seen theirs, and it will disappear from their view too. The underlying records stay intact and are recoverable by a database admin if ever needed, but this is not something to undo casually.`
      : `Void "${p.label}"? It will be hidden from this list, but its records stay intact and can be recovered by a database admin if ever needed.`;
    if (!confirm(warning)) return;

    setVoidingId(p.id);
    try {
      const res = await fetch(`/api/payroll/periods/${p.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) { showToast(data.error || 'Failed to void.', 'error'); return; }
      showToast('Payroll period voided.');
      onRefresh();
    } finally {
      setVoidingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <button onClick={onStartNew} className="btn-primary text-base py-3 px-6">
        <Plus size={18} /> Generate New Payroll
      </button>

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-300" size={24} /></div>
        ) : periods.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-12">No payroll periods yet. Click "Generate New Payroll" to create your first one.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="table-header">Period</th>
                  <th className="table-header">Employees</th>
                  <th className="table-header">Total Net Pay</th>
                  <th className="table-header">Status</th>
                  <th className="table-header"></th>
                  <th className="table-header"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {periods.map(p => (
                  <tr key={p.id} onClick={() => onOpen(p)} className="hover:bg-gray-50/60 cursor-pointer">
                    <td className="table-cell font-medium text-gray-900">{p.label}</td>
                    <td className="table-cell">{p.employee_count}</td>
                    <td className="table-cell font-medium">{formatCurrency(p.total_net_pay)}</td>
                    <td className="table-cell"><span className={STATUS_BADGE[p.status]}>{STATUS_LABEL[p.status]}</span></td>
                    <td className="table-cell text-orange-600 text-xs font-medium">Open →</td>
                    <td className="table-cell">
                      <button
                        onClick={e => voidPeriod(e, p)}
                        disabled={voidingId === p.id}
                        title={p.payslips_generated_at ? 'Void — payslips already generated, employees may have seen theirs' : 'Void payroll period'}
                        className="flex items-center gap-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 disabled:opacity-50 disabled:hover:bg-transparent transition-colors px-2 py-1 rounded-lg text-xs font-medium"
                      >
                        {voidingId === p.id ? <Loader2 size={14} className="animate-spin" /> : <Archive size={14} />}
                        Void
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Wizard shell ─────────────────────────────────────────────────────────

const STEP_LABELS = ['Select Payroll Period', 'Generate Payroll', 'Check Issues', 'Review Payroll', 'Approve & Generate Payslips'];

interface PeriodRange { from: string; to: string; label: string }

function PayrollWizard({ periodId, initialStep, onBackToList, onGenerated, showToast }: {
  periodId: number | null; initialStep: number; onBackToList: () => void;
  onGenerated: (id: number) => void; showToast: (m: string, t?: 'success' | 'error') => void;
}) {
  const [step, setStep] = useState(initialStep);
  const [selectedRange, setSelectedRange] = useState<PeriodRange | null>(null);
  const [currentPeriodId, setCurrentPeriodId] = useState<number | null>(periodId);
  const [period, setPeriod] = useState<any>(null);
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(currentPeriodId !== null);

  const fetchPeriod = () => {
    if (!currentPeriodId) return;
    setLoading(true);
    fetch(`/api/payroll/periods/${currentPeriodId}`).then(r => r.json()).then(d => {
      setPeriod(d.period); setEntries(d.entries); setLoading(false);
    });
  };
  useEffect(fetchPeriod, [currentPeriodId]);

  const handleSelected = (range: PeriodRange) => {
    setSelectedRange(range);
    setStep(2);
  };

  const handleGenerated = (id: number) => {
    setCurrentPeriodId(id);
    setStep(3);
    onGenerated(id);
  };

  return (
    <div className="space-y-6">
      <button onClick={onBackToList} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 py-2 -my-2">
        <ArrowLeft size={15} /> Back to Payroll List
      </button>

      {/* Step indicator */}
      <div className="flex items-center gap-1 flex-wrap">
        {STEP_LABELS.map((label, i) => {
          const n = i + 1;
          const active = n === step;
          const done = n < step;
          return (
            <div key={label} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold ${
              active ? 'bg-orange-500 text-white' : done ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'
            }`}>
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${active ? 'bg-white/20' : ''}`}>{n}</span>
              {label}
            </div>
          );
        })}
      </div>

      {step === 1 && <StepSelectPeriod onSelected={handleSelected} />}
      {step === 2 && selectedRange && <StepGeneratePayroll range={selectedRange} onGenerated={handleGenerated} showToast={showToast} />}

      {step >= 3 && loading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-300" size={24} /></div>
      ) : (
        <>
          {step === 3 && currentPeriodId && <StepCheckIssues periodId={currentPeriodId} onContinue={() => setStep(4)} />}
          {step === 4 && currentPeriodId && period && (
            <StepReviewPayroll period={period} entries={entries} onRefresh={fetchPeriod} onContinue={() => setStep(5)} showToast={showToast} />
          )}
          {step === 5 && currentPeriodId && period && (
            <StepApproveAndPayslips period={period} entries={entries} onRefresh={fetchPeriod} showToast={showToast} />
          )}
        </>
      )}
    </div>
  );
}

// ── Step 1: Select Payroll Period ───────────────────────────────────────

function StepSelectPeriod({ onSelected }: { onSelected: (range: PeriodRange) => void }) {
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  const todayISO = now.toISOString().slice(0, 10);
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [selected, setSelected] = useState<number | null>(null);
  const [label, setLabel] = useState('');

  const { cutoffs } = getDefaultCutoffs(year, month);
  const monthName = new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'long' });

  const changeMonth = (delta: number) => {
    let m = month + delta, y = year;
    if (m > 12) { m = 1; y++; } else if (m < 1) { m = 12; y--; }
    setMonth(m); setYear(y);
    setSelected(null);
  };

  const select = (i: number) => {
    if (cutoffs[i].to >= todayISO) return; // cutoff hasn't ended yet — see next()'s guard too
    setSelected(i);
    setLabel(cutoffs[i].label);
  };

  const next = () => {
    if (selected === null) return;
    const range = cutoffs[selected];
    onSelected({ from: range.from, to: range.to, label: label.trim() || range.label });
  };

  return (
    <div className="card space-y-5">
      <div>
        <p className="text-base font-semibold text-gray-900">Select a payroll period</p>
        <p className="text-sm text-gray-500 mt-0.5">Choose which cutoff you want to run payroll for.</p>
      </div>

      <div className="flex items-center justify-center gap-4">
        <button onClick={() => changeMonth(-1)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"><ChevronLeft size={18} /></button>
        <span className="text-sm font-semibold text-gray-800 w-40 text-center">{monthName} {year}</span>
        <button onClick={() => changeMonth(1)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"><ChevronRight size={18} /></button>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {cutoffs.map((c, i) => {
          const notEnded = c.to >= todayISO;
          return (
            <button
              key={c.from}
              onClick={() => select(i)}
              disabled={notEnded}
              className={`rounded-2xl border-2 p-6 text-left transition-colors ${
                notEnded ? 'border-gray-100 bg-gray-50 opacity-60 cursor-not-allowed' :
                selected === i ? 'border-orange-500 bg-orange-50' : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <p className="text-lg font-bold text-gray-900">{i === 0 ? '1st Half' : '2nd Half'}</p>
              <p className="text-sm text-gray-500">{c.label}</p>
              {notEnded && <p className="text-xs text-amber-600 mt-1">Cutoff hasn&apos;t ended yet</p>}
            </button>
          );
        })}
      </div>

      {selected !== null && (
        <div>
          <label className="form-label">Payroll Period Name</label>
          <input type="text" className="form-input" value={label} onChange={e => setLabel(e.target.value)} />
        </div>
      )}

      <button onClick={next} disabled={selected === null} className="btn-primary text-base py-3 px-8 disabled:opacity-50">
        Next: Generate Payroll
      </button>
    </div>
  );
}

// ── Step 2: Generate Payroll ─────────────────────────────────────────────

function StepGeneratePayroll({ range, onGenerated, showToast }: { range: PeriodRange; onGenerated: (id: number) => void; showToast: (m: string, t?: 'success' | 'error') => void }) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  const generate = async () => {
    setGenerating(true);
    setError('');
    try {
      const res = await fetch('/api/payroll/periods', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from_date: range.from, to_date: range.to, label: range.label }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to generate payroll.'); return; }
      showToast('Payroll generated!');
      onGenerated(data.id);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="card space-y-5 text-center">
      <div>
        <p className="text-base font-semibold text-gray-900">Ready to generate payroll</p>
        <p className="text-sm text-gray-500 mt-1">{range.label}</p>
        <p className="text-xs text-gray-400 mt-1">{formatDate(range.from)} – {formatDate(range.to)}</p>
      </div>
      <p className="text-sm text-gray-600 max-w-md mx-auto">
        This will automatically pull in attendance, approved overtime, and leave records for every employee in this period.
      </p>
      {error && <p className="text-sm text-red-500">{error}</p>}
      <button onClick={generate} disabled={generating} className="btn-primary text-base py-3 px-8 disabled:opacity-50 mx-auto">
        {generating ? <Loader2 size={18} className="animate-spin" /> : null}
        {generating ? 'Generating...' : 'Generate Payroll'}
      </button>
    </div>
  );
}

// ── Step 3: Check Issues ─────────────────────────────────────────────────

function StepCheckIssues({ periodId, onContinue }: { periodId: number; onContinue: () => void }) {
  const [warnings, setWarnings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/payroll/periods/${periodId}/warnings`).then(r => r.json()).then(d => {
      setWarnings(Array.isArray(d.warnings) ? d.warnings : []);
      setLoading(false);
    });
  }, [periodId]);

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-300" size={24} /></div>;

  return (
    <div className="card space-y-5">
      <div>
        <p className="text-base font-semibold text-gray-900">Attendance was imported automatically.</p>
        <p className="text-sm text-gray-500 mt-0.5">Here's anything that might need a second look — missing attendance, pending OT, pending corrections, or other issues.</p>
      </div>

      {warnings.length === 0 ? (
        <div className="flex items-center gap-3 bg-green-50 border border-green-100 rounded-xl p-5">
          <CheckCircle2 className="text-green-500" size={28} />
          <p className="text-green-700 font-semibold">No issues found — everything looks good.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-3 bg-amber-50 border border-amber-100 rounded-xl p-3.5">
              <AlertTriangle className="text-amber-500 shrink-0 mt-0.5" size={16} />
              <p className="text-sm text-amber-800">{w.message}</p>
            </div>
          ))}
          <p className="text-xs text-gray-400 pt-1">These are informational — you can still continue, but pending items won't be reflected until resolved and payroll is regenerated.</p>
        </div>
      )}

      <button onClick={onContinue} className="btn-primary text-base py-3 px-8">Continue to Review Payroll</button>
    </div>
  );
}

// ── Step 4: Review Payroll (summary + employee breakdown) ───────────────

function StepReviewPayroll({ period, entries, onRefresh, onContinue, showToast }: { period: any; entries: any[]; onRefresh: () => void; onContinue: () => void; showToast: (m: string, t?: 'success' | 'error') => void }) {
  const [detailEntry, setDetailEntry] = useState<any | null>(null);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const locked = period.status === 'locked';

  const totalEarnings = entries.reduce((s, e) => s + e.basic_pay + e.ot_pay + e.allowance_pay + e.bonus_earnings, 0);
  const totalDeductions = entries.reduce((s, e) => s + e.total_deductions, 0);
  const grossPayroll = entries.reduce((s, e) => s + e.gross_pay, 0);
  const netPayroll = entries.reduce((s, e) => s + e.net_pay, 0);
  const totalEmployerContributions = entries.reduce((s, e) =>
    s + (e.sss_er_contribution || 0) + (e.sss_ec_contribution || 0) + (e.philhealth_er_contribution || 0) + (e.pagibig_er_contribution || 0), 0);

  const cards = [
    { label: 'Number of Employees', value: String(entries.length) },
    { label: 'Gross Payroll', value: formatCurrency(grossPayroll) },
    { label: 'Total Deductions', value: formatCurrency(totalDeductions) },
    { label: 'Total Net Payroll', value: formatCurrency(netPayroll) },
  ];

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(c => (
          <div key={c.label} className="card">
            <p className="text-xs text-gray-500">{c.label}</p>
            <p className="text-xl font-bold text-gray-900 mt-1">{c.value}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-400">Total Earnings: {formatCurrency(totalEarnings)}</p>

      <div className="card bg-gray-50 border-gray-100">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Employer Contributions / Company Cost</p>
        <p className="text-xs text-gray-400 mt-0.5">SSS, EC, PhilHealth and Pag-IBIG employer shares — company cost only, already excluded from Net Pay above.</p>
        <p className="text-lg font-bold text-gray-900 mt-1">{formatCurrency(totalEmployerContributions)}</p>
      </div>

      <button onClick={() => setShowBreakdown(s => !s)} className="text-sm text-orange-600 hover:text-orange-700 font-medium">
        {showBreakdown ? 'Hide Employee Breakdown' : 'View Employee Breakdown'}
      </button>

      {showBreakdown && (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="table-header">Employee</th>
                  <th className="table-header">Basic Pay</th>
                  <th className="table-header">OT</th>
                  <th className="table-header">Allowance</th>
                  <th className="table-header">Late/Undertime</th>
                  <th className="table-header">Absence/Unpaid Leave</th>
                  <th className="table-header">Other Deduction</th>
                  <th className="table-header">Net Pay</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {entries.map(e => (
                  <tr key={e.id} onClick={() => setDetailEntry(e)} className="hover:bg-gray-50/60 cursor-pointer">
                    <td className="table-cell font-medium text-gray-900">{e.employee_name_snapshot}</td>
                    <td className="table-cell">{formatCurrency(e.basic_pay)}</td>
                    <td className="table-cell">{e.ot_pay > 0 ? formatCurrency(e.ot_pay) : '—'}</td>
                    <td className="table-cell">{formatCurrency(e.allowance_pay + e.bonus_earnings)}</td>
                    <td className="table-cell text-red-500">{(e.late_deduction + e.undertime_deduction) > 0 ? `-${formatCurrency(e.late_deduction + e.undertime_deduction)}` : '—'}</td>
                    <td className="table-cell text-red-500">{(e.absence_deduction + e.unpaid_leave_deduction) > 0 ? `-${formatCurrency(e.absence_deduction + e.unpaid_leave_deduction)}` : '—'}</td>
                    <td className="table-cell text-red-500">{(e.excess_break_deduction + e.other_deductions) > 0 ? `-${formatCurrency(e.excess_break_deduction + e.other_deductions)}` : '—'}</td>
                    <td className="table-cell font-semibold text-gray-900">{formatCurrency(e.net_pay)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-400 px-4 py-2 border-t border-gray-100">Click an employee to see the full breakdown and add bonuses or deductions.</p>
        </div>
      )}

      <button onClick={onContinue} className="btn-primary text-base py-3 px-8">Continue to Approve Payroll</button>

      {detailEntry && (
        <EntryDetailModal
          entryId={detailEntry.id}
          locked={locked}
          onClose={() => setDetailEntry(null)}
          onChanged={() => { onRefresh(); }}
          showToast={showToast}
        />
      )}
    </div>
  );
}

const CONTRIBUTION_FIELDS = [
  { key: 'sss_ee', column: 'sss_ee_contribution', label: 'SSS (Employee)' },
  { key: 'sss_er', column: 'sss_er_contribution', label: 'SSS (Employer)' },
  { key: 'sss_ec', column: 'sss_ec_contribution', label: 'EC (Employer)' },
  { key: 'philhealth_ee', column: 'philhealth_ee_contribution', label: 'PhilHealth (Employee)' },
  { key: 'philhealth_er', column: 'philhealth_er_contribution', label: 'PhilHealth (Employer)' },
  { key: 'pagibig_ee', column: 'pagibig_ee_contribution', label: 'Pag-IBIG (Employee)' },
  { key: 'pagibig_er', column: 'pagibig_er_contribution', label: 'Pag-IBIG (Employer)' },
] as const;

export function EntryDetailModal({ entryId, locked, onClose, onChanged, showToast }: { entryId: number; locked: boolean; onClose: () => void; onChanged: () => void; showToast: (m: string, t?: 'success' | 'error') => void }) {
  const [entry, setEntry] = useState<any>(null);
  const [adjustments, setAdjustments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDetails, setShowDetails] = useState(false);
  const [showAddAdjustment, setShowAddAdjustment] = useState(false);
  const [contributions, setContributions] = useState<Record<string, string>>({});
  const [savingContributions, setSavingContributions] = useState(false);

  const fetchDetail = () => {
    setLoading(true);
    fetch(`/api/payroll/entries/${entryId}`).then(r => r.json()).then(d => {
      setEntry(d.entry); setAdjustments(d.adjustments); setLoading(false);
      const c: Record<string, string> = {};
      for (const f of CONTRIBUTION_FIELDS) c[f.key] = String(d.entry?.[f.column] || 0);
      setContributions(c);
    });
  };
  useEffect(fetchDetail, [entryId]);

  const saveContributions = async () => {
    setSavingContributions(true);
    try {
      const res = await fetch(`/api/payroll/entries/${entryId}/contributions`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(CONTRIBUTION_FIELDS.map(f => [f.key, Number(contributions[f.key]) || 0]))),
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.error || 'Failed to save.', 'error'); return; }
      showToast('Contributions saved!');
      fetchDetail();
      onChanged();
    } finally {
      setSavingContributions(false);
    }
  };

  const removeAdjustment = async (adjId: number) => {
    await fetch(`/api/payroll/entries/${entryId}/adjustments/${adjId}`, { method: 'DELETE' });
    showToast('Adjustment removed.');
    fetchDetail();
    onChanged();
  };

  function fmtMin(m: number) { const h = Math.floor(m / 60), mm = m % 60; return h > 0 ? `${h}h ${mm}m` : `${mm}m`; }

  return (
    <Modal open={true} onClose={onClose} title={entry ? entry.employee_name_snapshot : 'Employee Pay'} size="md">
      {loading || !entry ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-300" size={24} /></div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Basic Pay</span><span className="font-medium">{formatCurrency(entry.basic_pay)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Approved OT</span><span className="font-medium">{formatCurrency(entry.ot_pay)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Allowance</span><span className="font-medium">{formatCurrency(entry.allowance_pay)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Bonus/Other Earnings</span><span className="font-medium">{formatCurrency(entry.bonus_earnings)}</span></div>
          </div>
          <div className="flex justify-between text-sm font-semibold border-t border-gray-100 pt-2">
            <span>Gross Pay</span><span>{formatCurrency(entry.gross_pay)}</span>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm border-t border-gray-100 pt-3">
            <div className="flex justify-between"><span className="text-gray-500">Late</span><span className="text-red-500">-{formatCurrency(entry.late_deduction)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Undertime</span><span className="text-red-500">-{formatCurrency(entry.undertime_deduction)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Absence</span><span className="text-red-500">-{formatCurrency(entry.absence_deduction)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Unpaid Leave</span><span className="text-red-500">-{formatCurrency(entry.unpaid_leave_deduction)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Excess Break</span><span className="text-red-500">-{formatCurrency(entry.excess_break_deduction)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">SSS</span><span className="text-red-500">-{formatCurrency(entry.sss_ee_contribution || 0)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">PhilHealth</span><span className="text-red-500">-{formatCurrency(entry.philhealth_ee_contribution || 0)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Pag-IBIG</span><span className="text-red-500">-{formatCurrency(entry.pagibig_ee_contribution || 0)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Other Deductions</span><span className="text-red-500">-{formatCurrency(entry.other_deductions)}</span></div>
          </div>
          <div className="flex justify-between text-sm font-semibold border-t border-gray-100 pt-2">
            <span>Total Deductions</span><span className="text-red-500">-{formatCurrency(entry.total_deductions)}</span>
          </div>

          <div className="flex justify-between text-base font-bold bg-gray-50 rounded-xl px-4 py-3">
            <span>NET PAY</span><span>{formatCurrency(entry.net_pay)}</span>
          </div>

          {/* Statutory Contributions are entered MANUALLY here, per payroll
              run — not auto-computed. Employee shares (above) reduce Net
              Pay; employer shares + EC never do, tracked as company cost
              only. */}
          <div className="bg-gray-50 rounded-xl p-3.5 text-xs space-y-2 border border-gray-100">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-gray-500 uppercase tracking-wide">Statutory Contributions</p>
              <span className="text-gray-400">Enter manually</span>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1">
              {CONTRIBUTION_FIELDS.map(f => (
                <div key={f.key}>
                  <label className="block text-gray-500 mb-0.5">{f.label}</label>
                  <input
                    type="number" min="0" step="0.01"
                    className="form-input py-1.5 text-xs"
                    value={contributions[f.key] ?? '0'}
                    disabled={locked}
                    onChange={e => setContributions(c => ({ ...c, [f.key]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
            <p className="text-gray-400 pt-1">Employee shares (SSS, PhilHealth, Pag-IBIG) reduce Net Pay above once saved. Employer shares + EC are company cost only — never deducted.</p>
            {!locked && (
              <button onClick={saveContributions} disabled={savingContributions} className="btn-secondary text-xs py-1.5 px-3 disabled:opacity-50">
                {savingContributions ? <Loader2 size={12} className="animate-spin inline mr-1" /> : null}
                {savingContributions ? 'Saving...' : 'Save Contributions'}
              </button>
            )}
          </div>

          <button onClick={() => setShowDetails(s => !s)} className="text-xs text-orange-600 hover:text-orange-700 font-medium">
            {showDetails ? 'Hide Details' : 'View Details'}
          </button>
          {showDetails && (
            <div className="bg-gray-50 rounded-xl p-3.5 text-xs text-gray-600 space-y-1.5">
              <p>Salary Type: <b>{entry.salary_type_snapshot}</b> — Rate used: <b>{formatCurrency(entry.basic_rate_snapshot)}</b></p>
              <p>Configured work days in period: <b>{entry.work_days_count}</b></p>
              <p>Late: <b>{fmtMin(entry.late_minutes)}</b> · Undertime: <b>{fmtMin(entry.undertime_minutes)}</b> · Excess Break: <b>{fmtMin(entry.excess_break_minutes)}</b></p>
              <p>Absence days: <b>{entry.absence_days}</b> · Unpaid Leave days: <b>{entry.unpaid_leave_days}</b></p>
              <p>Approved OT: <b>{fmtMin(entry.approved_ot_minutes)}</b> at <b>{entry.ot_multiplier_snapshot}×</b> rate</p>
              <p>Daily rate used for deductions: <b>{formatCurrency(entry.daily_rate ?? (entry.salary_type_snapshot === 'Daily' ? entry.basic_rate_snapshot : (entry.work_days_count > 0 ? (entry.basic_rate_snapshot / 2) / entry.work_days_count : 0)))}</b></p>
            </div>
          )}

          <div className="border-t border-gray-100 pt-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-700">Adjustments</p>
              {!locked && <button onClick={() => setShowAddAdjustment(true)} className="text-xs text-orange-600 hover:text-orange-700 font-medium">+ Add Adjustment</button>}
            </div>
            {adjustments.length === 0 ? (
              <p className="text-xs text-gray-400">No manual adjustments.</p>
            ) : (
              <div className="space-y-1.5">
                {adjustments.map((a: any) => (
                  <div key={a.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 text-xs">
                    <div>
                      <span className="font-medium text-gray-800">{ADJUSTMENT_LABELS[a.adjustment_type as AdjustmentType]}</span>
                      <span className={EARNING_TYPES.includes(a.adjustment_type) ? 'text-green-600' : 'text-red-500'}> {EARNING_TYPES.includes(a.adjustment_type) ? '+' : '-'}{formatCurrency(a.amount)}</span>
                      <p className="text-gray-400">{a.reason} — added by {a.added_by_name || 'admin'}</p>
                    </div>
                    {!locked && <button onClick={() => removeAdjustment(a.id)} className="text-red-400 hover:text-red-600"><Trash2 size={13} /></button>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {showAddAdjustment && (
            <AddAdjustmentForm
              entryId={entryId}
              onCancel={() => setShowAddAdjustment(false)}
              onSaved={() => { setShowAddAdjustment(false); showToast('Adjustment added!'); fetchDetail(); onChanged(); }}
            />
          )}
        </div>
      )}
    </Modal>
  );
}

function AddAdjustmentForm({ entryId, onCancel, onSaved }: { entryId: number; onCancel: () => void; onSaved: () => void }) {
  const [type, setType] = useState<AdjustmentType>('bonus');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) { setError('Enter a valid amount.'); return; }
    if (!reason.trim()) { setError('Reason is required.'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/payroll/entries/${entryId}/adjustments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adjustment_type: type, amount: numericAmount, reason: reason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to save.'); return; }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-orange-50 border border-orange-100 rounded-xl p-3.5 space-y-2.5">
      <div>
        <label className="form-label">Type</label>
        <select className="form-input" value={type} onChange={e => setType(e.target.value as AdjustmentType)}>
          {(Object.keys(ADJUSTMENT_LABELS) as AdjustmentType[]).map(t => <option key={t} value={t}>{ADJUSTMENT_LABELS[t]} ({EARNING_TYPES.includes(t) ? 'Earning' : 'Deduction'})</option>)}
        </select>
      </div>
      <div>
        <label className="form-label">Amount (₱)</label>
        <input type="number" className="form-input" value={amount} onChange={e => setAmount(e.target.value)} />
      </div>
      <div>
        <label className="form-label">Reason</label>
        <input type="text" className="form-input" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Performance bonus for August" />
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn-secondary text-xs py-1.5">Cancel</button>
        <button onClick={save} disabled={saving} className="btn-primary text-xs py-1.5 disabled:opacity-50">
          {saving ? <Loader2 size={12} className="animate-spin" /> : null}
          {saving ? 'Saving...' : 'Add'}
        </button>
      </div>
    </div>
  );
}

// ── Step 5: Approve & Generate Payslips ──────────────────────────────────
// One consolidated final screen — review, approve, generate payslips, mark
// paid, and lock all happen here in sequence. Only the button relevant to
// the period's CURRENT status is ever shown, so it never overwhelms: HR
// always sees exactly one next action.

function StepApproveAndPayslips({ period, entries, onRefresh, showToast }: { period: any; entries: any[]; onRefresh: () => void; showToast: (m: string, t?: 'success' | 'error') => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const netPayroll = entries.reduce((s, e) => s + e.net_pay, 0);

  const doTransition = async (action: 'review' | 'approve' | 'mark_paid' | 'lock') => {
    setBusy(action);
    try {
      const res = await fetch(`/api/payroll/periods/${period.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.error || 'Failed.', 'error'); return; }
      const messages: Record<string, string> = {
        review: 'Payroll marked for review!', approve: 'Payroll approved!',
        mark_paid: 'Payroll marked as Paid!', lock: 'Payroll Locked — no further changes are possible.',
      };
      showToast(messages[action]);
      onRefresh();
    } finally {
      setBusy(null);
    }
  };

  const generatePayslips = async () => {
    setBusy('payslips');
    try {
      const res = await fetch(`/api/payroll/periods/${period.id}/generate-payslips`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { showToast(data.error || 'Failed.', 'error'); return; }
      showToast('Payslips generated! Employees can now view them.');
      onRefresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card space-y-5">
      <div className="text-center">
        <p className="text-sm text-gray-500">Total Net Payroll</p>
        <p className="text-3xl font-bold text-gray-900 mt-1">{formatCurrency(netPayroll)}</p>
        <p className="text-xs text-gray-400 mt-1">{entries.length} employee(s) — {period.label}</p>
        <p className="text-xs text-gray-400 mt-2">
          Status: <span className={STATUS_BADGE[period.status]}>{STATUS_LABEL[period.status]}</span>
        </p>
      </div>

      <div className="space-y-3">
        {period.status === 'draft' && (
          <button onClick={() => doTransition('review')} disabled={!!busy} className="btn-secondary w-full justify-center text-base py-3 disabled:opacity-50">
            {busy === 'review' ? <Loader2 size={16} className="animate-spin" /> : null} Review Payroll
          </button>
        )}
        {period.status === 'for_review' && (
          <button onClick={() => doTransition('approve')} disabled={!!busy} className="btn-primary w-full justify-center text-base py-3 disabled:opacity-50">
            {busy === 'approve' ? <Loader2 size={16} className="animate-spin" /> : null} Approve Payroll
          </button>
        )}

        {(period.status === 'approved' || period.status === 'paid' || period.status === 'locked') && (
          !period.payslips_generated_at ? (
            <button onClick={generatePayslips} disabled={!!busy} className="btn-primary w-full justify-center text-base py-3 disabled:opacity-50">
              {busy === 'payslips' ? <Loader2 size={16} className="animate-spin" /> : null} Generate Payslips
            </button>
          ) : (
            <div className="flex items-center gap-2 text-green-700 bg-green-50 rounded-xl p-3 text-sm">
              <CheckCircle2 size={16} /> Payslips generated — visible to employees now.
            </div>
          )
        )}

        {period.payslips_generated_at && period.status === 'approved' && (
          <button onClick={() => doTransition('mark_paid')} disabled={!!busy} className="btn-primary w-full justify-center text-base py-3 disabled:opacity-50">
            {busy === 'mark_paid' ? <Loader2 size={16} className="animate-spin" /> : null} Mark as Paid
          </button>
        )}

        {period.status === 'paid' && (
          <button onClick={() => doTransition('lock')} disabled={!!busy} className="btn-secondary w-full justify-center text-base py-3 disabled:opacity-50">
            {busy === 'lock' ? <Loader2 size={16} className="animate-spin" /> : null} Lock Payroll
          </button>
        )}

        {period.status === 'locked' && (
          <div className="flex items-center justify-center gap-2 text-gray-600 bg-gray-100 rounded-xl p-4 text-sm font-medium">
            🔒 Payroll Locked — this period can no longer be edited.
          </div>
        )}
      </div>
    </div>
  );
}
