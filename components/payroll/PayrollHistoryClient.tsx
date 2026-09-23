'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { History, Loader2, Search, Users } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import { dailyRateOf, formatMinutesShort, isFixedRateEntry, roundOtMinutesToBlock } from '@/lib/payroll';
import Modal from '@/components/ui/Modal';
import { DetailsView, PAYMENT_BADGE, PAYMENT_LABEL, PAYSLIP_BADGE, PAYSLIP_LABEL, type Entry } from './PayslipsMonitor';
import { STATUS_BADGE, STATUS_LABEL } from './PayrollClient';

interface PeriodRow { id: number; label: string; from_date: string; to_date: string; pay_date: string | null; schedule: string | null; status: string; voided_at: string | null }
interface EmployeeRef { id: number; full_name: string }
// Shape shared by both "by period" (MonitorEntry) and "by employee" (HistoryEntry) rows —
// only the fields this screen actually reads.
interface HistoryRow {
  id: number; employee_id: number; employee_name: string; employee_code: string; department: string | null; pay_basis?: string;
  gross_pay: number; total_deductions: number; net_pay: number; payment_status: string; payslip_status: string;
  detail: Record<string, any>;
  // present only on "by employee" rows
  period_label?: string; pay_date?: string | null; period_status?: string; period_voided?: boolean;
}

const plainLabel = (l: string) => l.replace(/\s*\(Schedule [AB]\)\s*$/, '');

// Turns any row (period-side or employee-side) into the full shape <DetailsView>
// expects — this screen never checks for issues or emailability, so those are stubbed.
function toDetailsEntry(r: any): Entry {
  return { ...r, position: null, pay_basis: r.pay_basis, has_email: false, issues: [], has_issue: false };
}

// Read-only lookup of past payroll — by pay period (everyone in one run) or by
// employee (one person across every run, including voided ones) — for
// discrepancy-checking and record-keeping. Nothing here can change a figure.
export default function PayrollHistoryClient() {
  const router = useRouter();
  const [tab, setTab] = useState<'period' | 'employee'>('period');
  const [periods, setPeriods] = useState<PeriodRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeRef[]>([]);
  const [loadingPickers, setLoadingPickers] = useState(true);
  const [error, setError] = useState('');

  const [periodId, setPeriodId] = useState<number | null>(null);
  const [periodData, setPeriodData] = useState<any | null>(null);
  const [loadingPeriod, setLoadingPeriod] = useState(false);

  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [empSearch, setEmpSearch] = useState('');
  const [employeeRows, setEmployeeRows] = useState<any[] | null>(null);
  const [loadingEmployee, setLoadingEmployee] = useState(false);

  const [detailEntry, setDetailEntry] = useState<Entry | null>(null);

  useEffect(() => {
    fetch('/api/payroll/history').then(r => r.json()).then(d => {
      if (Array.isArray(d?.periods)) { setPeriods(d.periods); if (d.periods[0]) setPeriodId(d.periods[0].id); }
      if (Array.isArray(d?.employees)) setEmployees(d.employees);
      setLoadingPickers(false);
    }).catch(() => { setError('Could not load payroll history.'); setLoadingPickers(false); });
  }, []);

  useEffect(() => {
    if (!periodId) return;
    setLoadingPeriod(true); setPeriodData(null);
    fetch(`/api/payroll/history?period_id=${periodId}`).then(r => r.json()).then(d => setPeriodData(d.data ?? null)).finally(() => setLoadingPeriod(false));
  }, [periodId]);

  useEffect(() => {
    if (!employeeId) { setEmployeeRows(null); return; }
    setLoadingEmployee(true); setEmployeeRows(null);
    fetch(`/api/payroll/history?employee_id=${employeeId}`).then(r => r.json()).then(d => setEmployeeRows(d.entries ?? [])).finally(() => setLoadingEmployee(false));
  }, [employeeId]);

  const filteredEmployees = useMemo(() => {
    const q = empSearch.trim().toLowerCase();
    return q ? employees.filter(e => e.full_name.toLowerCase().includes(q)) : employees;
  }, [employees, empSearch]);

  const RowView = ({ r, showPeriod }: { r: HistoryRow; showPeriod?: boolean }) => {
    const fixed = isFixedRateEntry(r);
    return (
      <tr onClick={() => setDetailEntry(toDetailsEntry(r))} className="hover:bg-gray-50/60 cursor-pointer">
        {showPeriod ? (
          <td className="table-cell">
            <span className="font-medium text-gray-900">{plainLabel(r.period_label ?? '')}</span>
            {r.period_voided && <span className="ml-1.5 badge-red">Voided</span>}
            <p className="text-[11px] text-gray-400">{r.pay_date ? `Pay date ${formatDate(r.pay_date)}` : ''}</p>
          </td>
        ) : (
          <td className="table-cell">
            <span className="font-medium text-gray-900">{r.employee_name}</span>
            <p className="text-[11px] text-gray-400">{[r.employee_code, r.department].filter(Boolean).join(' · ')}</p>
          </td>
        )}
        <td className="table-cell text-right tabular-nums text-gray-600">{fixed ? '—' : r.detail.work_days_count}</td>
        <td className="table-cell text-right tabular-nums text-gray-600">{fixed ? `${formatCurrency(r.detail.basic_rate)} (Fixed)` : formatCurrency(dailyRateOf(r.detail as any))}</td>
        <td className="table-cell text-right tabular-nums">{formatCurrency(r.detail.basic_pay)}</td>
        <td className="table-cell text-right tabular-nums text-gray-600">{r.detail.approved_ot_minutes > 0 ? `${formatMinutesShort(roundOtMinutesToBlock(r.detail.approved_ot_minutes))} · ${formatCurrency(r.detail.ot_pay)}` : '—'}</td>
        <td className="table-cell text-right tabular-nums text-gray-600">{r.total_deductions ? formatCurrency(r.total_deductions) : '—'}</td>
        <td className="table-cell text-right tabular-nums font-semibold text-gray-900">{formatCurrency(r.net_pay)}</td>
        <td className="table-cell"><span className={PAYMENT_BADGE[r.payment_status]}>{PAYMENT_LABEL[r.payment_status]}</span></td>
        <td className="table-cell"><span className={PAYSLIP_BADGE[r.payslip_status]}>{PAYSLIP_LABEL[r.payslip_status]}</span></td>
      </tr>
    );
  };

  const Head = ({ first }: { first: string }) => (
    <thead>
      <tr className="border-b border-gray-100">
        <th className="table-header">{first}</th>
        <th className="table-header text-right">Days</th>
        <th className="table-header text-right">Daily Rate</th>
        <th className="table-header text-right">Basic Pay</th>
        <th className="table-header text-right">OT</th>
        <th className="table-header text-right">Deductions</th>
        <th className="table-header text-right">Net Pay</th>
        <th className="table-header">Payment</th>
        <th className="table-header">Payslip</th>
      </tr>
    </thead>
  );

  return (
    <div className="p-3 sm:p-4 lg:p-6 space-y-4 sm:space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2"><History size={22} className="text-orange-500" />Payroll History</h1>
        <p className="text-sm text-gray-500 mt-1">Look up any past payroll run, or one employee across every run — for reference and record-keeping. Nothing here can be changed.</p>
      </div>

      {error && <div className="card text-sm text-red-600">{error}</div>}

      <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden bg-white">
        <button onClick={() => setTab('period')} className={`px-4 py-2 text-sm font-medium ${tab === 'period' ? 'bg-orange-500 text-white' : 'text-gray-700 hover:bg-gray-50'}`}>By Pay Period</button>
        <button onClick={() => setTab('employee')} className={`px-4 py-2 text-sm font-medium ${tab === 'employee' ? 'bg-orange-500 text-white' : 'text-gray-700 hover:bg-gray-50'}`}><Users size={14} className="inline -mt-0.5 mr-1" />By Employee</button>
      </div>

      {loadingPickers ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin text-gray-300" size={26} /></div>
      ) : tab === 'period' ? (
        <div className="space-y-4">
          <div>
            <label className="form-label" htmlFor="ph-period">Pay period</label>
            <select id="ph-period" className="form-input max-w-md" value={periodId ?? ''} onChange={e => setPeriodId(Number(e.target.value))}>
              {periods.map(p => (
                <option key={p.id} value={p.id}>{plainLabel(p.label)}{p.schedule ? ` — Schedule ${p.schedule}` : ''}{p.voided_at ? ' (Voided)' : ''}</option>
              ))}
            </select>
          </div>

          {loadingPeriod ? (
            <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-300" size={22} /></div>
          ) : periodData ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className={STATUS_BADGE[periodData.period.status]}>{STATUS_LABEL[periodData.period.status] ?? periodData.period.status}</span>
                {periodData.period.voided_at && <span className="badge-red">Voided {formatDate(periodData.period.voided_at.slice(0, 10))}</span>}
                <span className="text-sm text-gray-500">{periodData.entries.length} employee{periodData.entries.length === 1 ? '' : 's'} · Pay date {periodData.period.pay_date ? formatDate(periodData.period.pay_date) : '—'} · Total Net {formatCurrency(periodData.owner.net)}</span>
                <button onClick={() => router.push(`/payslips?period=${periodData.period.id}`)} className="btn-secondary text-xs py-1.5 ml-auto">Open in Payroll Monitor →</button>
              </div>
              <div className="card p-0 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <Head first="Employee" />
                    <tbody className="divide-y divide-gray-50">
                      {periodData.entries.map((e: any) => <RowView key={e.id} r={e} />)}
                    </tbody>
                  </table>
                </div>
                {periodData.entries.length === 0 && <p className="text-sm text-gray-400 text-center py-10">No employees in this run.</p>}
              </div>
            </>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="relative max-w-md">
            <label className="form-label" htmlFor="ph-emp-search">Employee</label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
              <input id="ph-emp-search" className="form-input pl-9" placeholder="Search name…" value={empSearch} onChange={e => setEmpSearch(e.target.value)} />
            </div>
            {empSearch && (
              <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg">
                {filteredEmployees.length === 0 && <p className="text-sm text-gray-400 px-3 py-2">No match.</p>}
                {filteredEmployees.map(e => (
                  <button key={e.id} onClick={() => { setEmployeeId(e.id); setEmpSearch(e.full_name); }} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50">{e.full_name}</button>
                ))}
              </div>
            )}
          </div>

          {loadingEmployee ? (
            <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-300" size={22} /></div>
          ) : employeeRows === null ? (
            <p className="text-sm text-gray-400">Search and pick an employee above to see their payroll history.</p>
          ) : employeeRows.length === 0 ? (
            <p className="text-sm text-gray-400">No payroll records found for this employee yet.</p>
          ) : (
            <div className="card p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <Head first="Pay Period" />
                  <tbody className="divide-y divide-gray-50">
                    {employeeRows.map((e: any) => <RowView key={e.id} r={e} showPeriod />)}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {detailEntry && (
        <Modal open onClose={() => setDetailEntry(null)} title={`Payroll Details — ${detailEntry.employee_name}`} size="lg">
          <DetailsView entry={detailEntry} />
          <div className="flex justify-end mt-5"><button className="btn-secondary" onClick={() => setDetailEntry(null)}>Close</button></div>
        </Modal>
      )}
    </div>
  );
}
