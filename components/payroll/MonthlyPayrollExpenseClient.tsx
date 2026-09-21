'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, CheckCircle2, ChevronLeft, ChevronRight, Download, FileSpreadsheet, Info, Loader2, Printer, X,
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

// Company-wide payroll cost for one month, read from the figures payroll already
// recorded (see lib/payroll-expense.ts). Every number on this page comes from
// /api/payroll/reports/monthly-expense; nothing is recomputed here.

const peso = (n: number) => {
  const v = Number(n) || 0;
  return `${v < 0 ? '−' : ''}₱${Math.abs(v).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const signedPeso = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}₱${Math.abs(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number, digits = 1) => `${n.toFixed(digits)}%`;
const fmtDate = (iso: string | null) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-PH', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
};
const shiftMonth = (m: string, n: number) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };

const STATUS_BADGE: Record<string, [string, string]> = {
  draft: ['Draft', 'badge-gray'], for_review: ['For Approval', 'badge-amber'], approved: ['Approved', 'badge-blue'], paid: ['Paid', 'badge-green'], locked: ['Paid · Locked', 'badge-green'],
};

type SortKey = 'name' | 'department' | 'basic' | 'overtime' | 'allowances' | 'gross' | 'employer' | 'net' | 'total_cost';

export default function MonthlyPayrollExpenseClient() {
  const [month, setMonth] = useState('');
  const [basis, setBasis] = useState('approved_paid');
  const [groupBy, setGroupBy] = useState('period_end');
  const [schedule, setSchedule] = useState('');
  const [department, setDepartment] = useState('');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [metric, setMetric] = useState<'expense' | 'net' | 'both'>('expense');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'total_cost', dir: 'desc' });
  const [otOnly, setOtOnly] = useState(false);
  const [tableDept, setTableDept] = useState('');
  const [showChecks, setShowChecks] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams({ basis, group: groupBy });
      if (month) qs.set('month', month);
      if (schedule) qs.set('schedule', schedule);
      if (department) qs.set('department', department);
      const res = await fetch(`/api/payroll/reports/monthly-expense?${qs}`);
      const d = await res.json();
      if (!res.ok) { setError(d.error || 'Could not load the report.'); setData(null); return; }
      setData(d);
      if (!month) setMonth(d.month);
    } catch {
      setError('Could not load the report.');
    } finally {
      setLoading(false);
    }
  }, [month, basis, groupBy, schedule, department]);

  useEffect(() => { load(); }, [load]);

  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });

  // ---- employee table: sorted + drill-down filters ----
  const rows = useMemo(() => {
    if (!data) return [];
    let list: any[] = data.employees;
    if (otOnly) list = list.filter(e => e.overtime > 0);
    if (tableDept) list = list.filter(e => e.department === tableDept);
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const av = a[sort.key], bv = b[sort.key];
      return (typeof av === 'string' ? av.localeCompare(bv) : av - bv) * dir;
    });
  }, [data, otOnly, tableDept, sort]);
  const setSortKey = (key: SortKey) => setSort(s => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' || key === 'department' ? 'asc' : 'desc' }));

  // ---- CSV (opens in Excel) ----
  const exportCsv = () => {
    if (!data) return;
    const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const n = (v: number) => (Number(v) || 0).toFixed(2);
    const lines: (string | number)[][] = [
      ['Monthly Payroll Expense'], ['Month', data.label], ['Reporting basis', data.basis_label], ['Runs counted by', data.group_by === 'pay_date' ? 'Pay date' : 'Pay period end'],
      ['Schedule', data.schedule ? `Schedule ${data.schedule}` : 'All'], ['Department', data.department ?? 'All'],
      ['Month-to-date', data.partial.is_partial ? `Yes — data through ${fmtDate(data.partial.through)}` : 'No'], [],
      ['SUMMARY'], ['Total Payroll Expense (Gross + Employer Contributions)', n(data.summary.total_expense)], ['Net Salaries', n(data.summary.net_salaries)], ['Gross Pay', n(data.summary.gross_pay)],
      ['Overtime Cost', n(data.summary.overtime_cost)], ['Allowances / Bonuses', n(data.summary.allowances_bonuses)], ['Employer Contributions', n(data.summary.employer_contributions)],
      ['Employees', data.summary.employees], ['Average Payroll Cost per Employee', n(data.summary.avg_cost_per_employee)], [],
      ['PAYROLL COST BREAKDOWN'], ...data.breakdown.earnings.map((r: any) => [r.label, n(r.amount)]), ['Gross Pay', n(data.breakdown.gross)],
      ...data.breakdown.employer.map((r: any) => [r.label, n(r.amount)]), ['Employer Contributions', n(data.breakdown.employer_total)], ['TOTAL PAYROLL EXPENSE', n(data.breakdown.total_expense)], [],
      ['EMPLOYEE DEDUCTIONS (reference only)'], ...data.breakdown.deductions.map((r: any) => [r.label, n(r.amount)]), ['Total Deductions', n(data.breakdown.deductions_total)], ['Net Pay', n(data.breakdown.net)], [],
      ['PAYROLL CASH REQUIREMENT (net salaries)'], ['Already paid', n(data.cash.paid)], ['Approved but unpaid', n(data.cash.approved_unpaid)], ['Awaiting approval (draft / for approval)', n(data.cash.awaiting_approval)], ['Total', n(data.cash.total)], [],
      ['PAYROLL COST BY DEPARTMENT'], ['Department', 'Employees', 'Total Payroll Expense', '% of Total'], ...data.departments.map((d: any) => [d.department, d.employees, n(d.total_expense), d.percent.toFixed(1)]), [],
      ['PAYROLL RUNS INCLUDED'], ['Run', 'Schedule', 'Pay date', 'Status', 'Employees', 'Gross', 'Net', 'Employer contributions', 'Total expense'],
      ...data.runs.map((r: any) => [r.label, r.schedule ?? '', r.pay_date ?? '', (STATUS_BADGE[r.status] ?? [r.status])[0], r.employees, n(r.gross), n(r.net), n(r.employer), n(r.total_expense)]), [],
      ['EMPLOYEE COST'], ['Employee', 'Department', 'Basic Pay', 'Overtime', 'Allowances / Bonuses', 'Gross Pay', 'Employer Contributions', 'Net Pay', 'Total Employer Cost'],
      ...data.employees.map((e: any) => [e.name, e.department, n(e.basic), n(e.overtime), n(e.allowances), n(e.gross), n(e.employer), n(e.net), n(e.total_cost)]),
    ];
    const csv = '﻿' + lines.map(row => row.map(q).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `monthly-payroll-expense-${data.month}.csv`;
    a.click();
  };

  const s = data?.summary;
  const problems = data ? data.checks.filter((c: any) => c.severity !== 'ok') : [];
  const errorChecks = problems.filter((c: any) => c.severity === 'error');
  const emptyMonth = data && data.runs.length === 0;

  const Card = ({ label, value, note, onClick, main, tone }: { label: string; value: React.ReactNode; note?: string; onClick?: () => void; main?: boolean; tone?: 'amber' }) => {
    const body = (
      <>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</div>
        <div className={`mt-1.5 font-bold tabular-nums text-gray-900 ${main ? 'text-2xl sm:text-3xl' : 'text-xl sm:text-2xl'} ${tone === 'amber' ? 'text-amber-600' : ''}`}>{value}</div>
        <div className="mt-0.5 text-[11px] text-gray-400 min-h-[1rem]">{note ?? ' '}</div>
      </>
    );
    const cls = `card p-3 sm:p-4 text-left w-full ${main ? 'border-orange-300 ring-1 ring-orange-100' : ''}`;
    return onClick ? <button type="button" onClick={onClick} className={`${cls} hover:border-orange-300 transition-colors`}>{body}</button> : <div className={cls}>{body}</div>;
  };
  const Section = ({ id, title, hint, children }: { id: string; title: string; hint?: string; children: React.ReactNode }) => (
    <section id={id} className="card p-4 sm:p-5 scroll-mt-4 break-inside-avoid">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 mb-3">
        <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">{title}</h2>
        {hint && <p className="text-xs text-gray-400">{hint}</p>}
      </div>
      {children}
    </section>
  );
  const Line = ({ label, amount, strong, muted }: { label: string; amount: number; strong?: boolean; muted?: boolean }) => (
    <div className={`flex justify-between gap-3 py-1.5 text-sm border-b border-gray-50 ${strong ? 'font-bold text-gray-900' : muted ? 'text-gray-400' : 'text-gray-700'}`}>
      <span>{label}</span><span className="tabular-nums whitespace-nowrap">{peso(amount)}</span>
    </div>
  );
  const Th = ({ k, label, right }: { k: SortKey; label: string; right?: boolean }) => (
    <th className={`table-header whitespace-nowrap ${right ? 'text-right' : ''}`}>
      <button type="button" onClick={() => setSortKey(k)} className="inline-flex items-center gap-1 uppercase hover:text-gray-800" aria-label={`Sort by ${label}`}>
        {label}{sort.key === k ? (sort.dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />) : <ArrowUpDown size={11} className="opacity-30" />}
      </button>
    </th>
  );

  const notesBlock = data ? data.notes.map((n: any) => (
    <div key={n.code} className={`rounded-lg border px-3.5 py-2.5 text-sm flex gap-2 ${n.severity === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-blue-200 bg-blue-50 text-blue-900'}`}>
      {n.severity === 'warning' ? <AlertTriangle size={16} className="shrink-0 mt-0.5" /> : <Info size={16} className="shrink-0 mt-0.5" />}{n.message}
    </div>
  )) : null;
  const trendData = data ? data.trend.map((t: any) => ({ ...t, name: t.short })) : [];

  return (
    <div className="p-3 sm:p-4 lg:p-6 space-y-4 sm:space-y-5 mpe-root">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Monthly Payroll Expense</h1>
          <p className="text-sm text-gray-500 mt-1">Track total salary expenses, overtime, allowances, employer contributions, and payroll trends.</p>
        </div>
        <div className="flex gap-2 print:hidden">
          <button onClick={() => window.print()} disabled={!data} className="btn-secondary text-xs py-2.5 sm:py-1.5 disabled:opacity-40"><Printer size={13} /> Export PDF</button>
          <button onClick={exportCsv} disabled={!data} className="btn-secondary text-xs py-2.5 sm:py-1.5 disabled:opacity-40"><FileSpreadsheet size={13} /> Export Excel/CSV</button>
        </div>
      </div>

      {/* Filters */}
      <div className="card p-3 sm:p-4 print:hidden">
        <div className="flex flex-col lg:flex-row lg:flex-wrap lg:items-end gap-3">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Month</label>
            <div className="mt-1 flex items-center gap-1.5">
              <button type="button" aria-label="Previous month" onClick={() => month && setMonth(shiftMonth(month, -1))} className="p-2.5 sm:p-2 rounded-lg border border-gray-200 hover:bg-gray-50"><ChevronLeft size={15} /></button>
              <select aria-label="Month" className="form-input min-w-[170px] font-semibold" value={month} onChange={e => setMonth(e.target.value)}>
                {(data?.options.months ?? (month ? [{ value: month, label: month }] : [])).map((m: any) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
              <button type="button" aria-label="Next month" onClick={() => month && setMonth(shiftMonth(month, 1))} className="p-2.5 sm:p-2 rounded-lg border border-gray-200 hover:bg-gray-50"><ChevronRight size={15} /></button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:contents">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Schedule</label>
            <select aria-label="Schedule" className="form-input mt-1 w-full lg:w-auto min-w-0" value={schedule} onChange={e => setSchedule(e.target.value)}>
              <option value="">All Schedules</option><option value="A">Schedule A</option><option value="B">Schedule B</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Department</label>
            <select aria-label="Department" className="form-input mt-1 w-full lg:w-auto min-w-0" value={department} onChange={e => { setDepartment(e.target.value); setTableDept(''); }}>
              <option value="">All Departments</option>{(data?.options.departments ?? []).map((d: any) => <option key={d.key} value={d.value}>{d.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Include</label>
            <select aria-label="Payroll status basis" className="form-input mt-1 w-full lg:w-auto min-w-0" value={basis} onChange={e => setBasis(e.target.value)}>
              <option value="paid">Paid Only</option><option value="approved_paid">Approved + Paid</option><option value="all">All Payroll Runs</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Count runs by</label>
            <select aria-label="Count runs by" className="form-input mt-1 w-full lg:w-auto min-w-0" value={groupBy} onChange={e => setGroupBy(e.target.value)}>
              <option value="period_end">Pay period end</option><option value="pay_date">Pay date</option>
            </select>
          </div>
          </div>
        </div>
        <nav className="mt-3 pt-3 border-t border-gray-100 flex gap-1.5 overflow-x-auto text-xs" aria-label="Report sections">
          {[['sec-summary', 'Summary'], ['sec-cash', 'Cash'], ['sec-trend', 'Trend & History'], ['sec-breakdown', 'Cost Breakdown'], ['sec-departments', 'Departments'], ['sec-overtime', 'Overtime'], ['sec-allowances', 'Allowances'], ['sec-contributions', 'Employer Contributions'], ['sec-runs', 'Payroll Runs'], ['sec-employees', 'Employees'], ['sec-checks', 'Data Checks']].map(([id, label]) => (
            <button key={id} type="button" onClick={() => scrollTo(id)} className="shrink-0 whitespace-nowrap px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-orange-50 hover:text-orange-700 font-medium">{label}</button>
          ))}
        </nav>
      </div>

      {loading && !data ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin text-gray-300" size={26} /></div>
      ) : error ? (
        <div className="card text-sm text-red-600">{error}</div>
      ) : data && (
        <div className={loading ? 'opacity-60 transition-opacity space-y-4 sm:space-y-5' : 'space-y-4 sm:space-y-5'}>
          {/* What this report is counting */}
          <div className="text-xs text-gray-500 flex flex-wrap gap-x-4 gap-y-1">
            <span><b className="text-gray-700">{data.label}</b>{data.partial.is_partial ? ' · Month-to-date' : ''}</span>
            <span data-testid="basis">Reporting basis: <b className="text-gray-700">{data.basis_label}</b></span>
            <span>Runs counted by {data.group_by === 'pay_date' ? 'pay date' : 'the month their pay period ends'}</span>
            {data.schedule && <span>Schedule {data.schedule} only</span>}{data.department && <span>{data.department} only</span>}
          </div>
          {data.partial.note && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900 flex gap-2" role="status"><Info size={16} className="shrink-0 mt-0.5" />{data.partial.note}</div>
          )}
          {errorChecks.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800 flex gap-2 items-start" role="alert">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <span>Payroll data check: {errorChecks.map((c: any) => c.title).join('; ')}. Totals below may not be reliable — <button type="button" className="underline font-semibold" onClick={() => { setShowChecks(true); scrollTo('sec-checks'); }}>see Data Checks</button>.</span>
            </div>
          )}
          {emptyMonth ? (
            <>{notesBlock}<div className="card text-center py-14 px-4">
              <p className="text-sm text-gray-600 font-medium">No payroll runs for {data.label} on this basis.</p>
              <p className="text-xs text-gray-400 mt-1">Try “All Payroll Runs”, another month, or clear the schedule / department filter.</p>
            </div></>
          ) : (
            <>
              {/* Summary cards */}
              <section id="sec-summary" className="grid grid-cols-2 lg:grid-cols-6 gap-3 scroll-mt-4">
                <div className="col-span-2 lg:col-span-2"><Card main label="Total Payroll Expense" value={peso(s.total_expense)} note="Gross pay + employer contributions" /></div>
                <Card label="Net Salaries" value={peso(s.net_salaries)} note="What employees receive" />
                <Card label="Overtime Cost" value={peso(s.overtime_cost)} note={otOnly ? 'Showing OT employees ↓' : 'Click to list OT employees'} onClick={() => { setOtOnly(true); scrollTo('sec-employees'); }} />
                <Card label="Allowances / Bonuses" value={peso(s.allowances_bonuses)} onClick={() => scrollTo('sec-allowances')} note="Click for details" />
                <Card label="Employer Contributions" value={peso(s.employer_contributions)} tone={s.employer_contributions === 0 ? 'amber' : undefined} onClick={() => scrollTo('sec-contributions')} note={s.employer_contributions === 0 ? 'None recorded' : 'Click for breakdown'} />
                <Card label="Employees Paid" value={s.employees} note={`${s.runs} payroll run${s.runs === 1 ? '' : 's'}`} onClick={() => { setOtOnly(false); setTableDept(''); scrollTo('sec-employees'); }} />
                <Card label="Avg Cost / Employee" value={peso(s.avg_cost_per_employee)} note={`${peso(s.total_expense)} ÷ ${s.employees}`} />
              </section>

              {notesBlock}

              {/* Cash requirement */}
              <Section id="sec-cash" title="Payroll Cash Requirement" hint="Net salaries of every payroll run in this month, whatever their status">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  {[['Already Paid', data.cash.paid, 'text-emerald-600'], ['Approved but Unpaid', data.cash.approved_unpaid, 'text-amber-600'], ['Awaiting Approval', data.cash.awaiting_approval, 'text-gray-900'], ['Total Payroll Cash Requirement', data.cash.total, 'text-gray-900']].map(([l, v, c]) => (
                    <div key={l as string} className="rounded-lg bg-gray-50 p-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{l}</p><p className={`mt-1 text-lg font-bold tabular-nums ${c}`}>{peso(v as number)}</p></div>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-3">“Awaiting Approval” is payroll already computed but still Draft / For Approval — not an estimate. Payroll not yet generated is not included. Government contributions to remit for approved runs (employee + employer shares): <b className="text-gray-600">{peso(data.cash.contributions_to_remit)}</b>, not counted above.</p>
              </Section>

              {/* Month over month + trend */}
              <Section id="sec-trend" title="Monthly Payroll Expense Trend" hint="Last 12 months on the same basis · click a bar to open that month">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4" data-testid="comparison">
                  <div><p className="text-xs text-gray-500">Current Month</p><p className="text-sm font-semibold text-gray-700">{data.comparison.current.label}</p><p className="text-lg font-bold tabular-nums text-gray-900">{peso(data.comparison.current.total)}</p></div>
                  <div><p className="text-xs text-gray-500">Previous Month</p>
                    {data.comparison.previous ? <><p className="text-sm font-semibold text-gray-700">{data.comparison.previous.label}</p><p className="text-lg font-bold tabular-nums text-gray-900">{peso(data.comparison.previous.total)}</p></> : <p className="text-sm text-gray-400 pt-1">No earlier payroll</p>}
                  </div>
                  <div className="col-span-2">
                    <p className="text-xs text-gray-500">Difference</p>
                    {data.comparison.comparable ? (
                      <p className={`text-lg font-bold tabular-nums ${data.comparison.difference > 0 ? 'text-amber-600' : data.comparison.difference < 0 ? 'text-emerald-600' : 'text-gray-900'}`}>
                        {signedPeso(data.comparison.difference)}{data.comparison.percent !== null && <span className="ml-2 text-sm font-semibold text-gray-500">{data.comparison.percent > 0 ? '+' : data.comparison.percent < 0 ? '−' : ''}{pct(Math.abs(data.comparison.percent))}</span>}
                        {data.comparison.mode === 'month_to_date' && <span className="ml-2 text-xs font-medium text-gray-400">month-to-date comparison</span>}
                      </p>
                    ) : (
                      <><p className="text-sm font-semibold text-gray-500 pt-1">Not directly comparable</p><p className="text-xs text-gray-400">{data.comparison.reason}</p></>
                    )}
                  </div>
                </div>
                <div className="flex gap-1.5 mb-3 print:hidden" role="group" aria-label="Trend metric">
                  {([['expense', 'Total Payroll Expense'], ['net', 'Net Payroll'], ['both', 'Both']] as const).map(([k, l]) => (
                    <button key={k} type="button" onClick={() => setMetric(k)} aria-pressed={metric === k}
                      className={`px-3 py-2 sm:py-1.5 rounded-lg text-xs font-semibold ${metric === k ? 'bg-orange-500 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-100'}`}>{l}</button>
                  ))}
                </div>
                <div className="h-64 sm:h-72" data-testid="trend-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={trendData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef0f2" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
                      <Tooltip formatter={(v: number) => peso(v)} labelFormatter={(_l: string, p: any) => `${p?.[0]?.payload?.label ?? ''}${p?.[0]?.payload?.partial ? ' (month-to-date)' : ''}`} />
                      {metric === 'both' && <Legend wrapperStyle={{ fontSize: 12 }} />}
                      {(metric === 'expense' || metric === 'both') && (
                        <Bar dataKey="total_expense" name="Total Payroll Expense" fill="#f97316" radius={[3, 3, 0, 0]} isAnimationActive={false} onClick={(d: any) => d?.month && setMonth(d.month)}>
                          {trendData.map((t: any) => <Cell key={t.month} fillOpacity={t.partial ? 0.45 : t.month === data.month ? 1 : 0.8} />)}
                        </Bar>
                      )}
                      {(metric === 'net' || metric === 'both') && (
                        <Bar dataKey="net_payroll" name="Net Payroll" fill="#64748b" radius={[3, 3, 0, 0]} isAnimationActive={false} onClick={(d: any) => d?.month && setMonth(d.month)}>
                          {trendData.map((t: any) => <Cell key={t.month} fillOpacity={t.partial ? 0.45 : t.month === data.month ? 1 : 0.8} />)}
                        </Bar>
                      )}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-[11px] text-gray-400 mt-1">Lighter bar = month still in progress.</p>

                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mt-5 mb-2">Payroll History</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="history">
                    <thead><tr className="border-b border-gray-100"><th className="table-header">Month</th><th className="table-header text-right">Runs</th><th className="table-header text-right">Employees</th><th className="table-header text-right">Total Payroll Expense</th><th className="table-header text-right">Net Payroll</th></tr></thead>
                    <tbody className="divide-y divide-gray-50">
                      {[...data.trend].reverse().filter((t: any) => t.runs > 0 || t.month === data.month).map((t: any) => (
                        <tr key={t.month} className={t.month === data.month ? 'bg-orange-50/50' : 'hover:bg-gray-50/60'}>
                          <td className="table-cell"><button type="button" className="font-medium text-gray-900 hover:text-orange-600 text-left" onClick={() => setMonth(t.month)}>{t.label}{t.partial ? <span className="ml-1.5 text-[11px] text-amber-600 font-normal">month-to-date</span> : null}</button></td>
                          <td className="table-cell text-right tabular-nums">{t.runs}</td><td className="table-cell text-right tabular-nums">{t.employees}</td>
                          <td className="table-cell text-right tabular-nums font-semibold">{peso(t.total_expense)}</td><td className="table-cell text-right tabular-nums text-gray-600">{peso(t.net_payroll)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>

              {/* Breakdown */}
              <Section id="sec-breakdown" title="Payroll Cost Breakdown" hint="Total Payroll Expense is gross pay plus employer-side contributions — never net pay">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-5">
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Earnings</p>
                    {data.breakdown.earnings.map((l: any) => <Line key={l.key} label={l.label} amount={l.amount} muted={l.amount === 0} />)}
                    <Line strong label="Gross Pay" amount={data.breakdown.gross} />
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mt-4 mb-1">Employer Contributions</p>
                    {data.breakdown.employer.map((l: any) => <Line key={l.key} label={l.label} amount={l.amount} muted={l.amount === 0} />)}
                    <Line strong label="Employer Contributions" amount={data.breakdown.employer_total} />
                    <div className="flex justify-between gap-3 pt-3 mt-1 text-base font-bold text-gray-900 border-t-2 border-gray-200" data-testid="total-expense"><span>TOTAL PAYROLL EXPENSE</span><span className="tabular-nums">{peso(data.breakdown.total_expense)}</span></div>
                    <p className="text-[11px] text-gray-400 mt-2">Not tracked by payroll yet, so not shown: {data.breakdown.not_tracked.join(', ')}.</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Employee Deductions <span className="normal-case font-normal text-gray-400">(reference — not subtracted from expense)</span></p>
                    {data.breakdown.deductions.filter((l: any) => l.amount !== 0).map((l: any) => <Line key={l.key} label={l.label} amount={l.amount} />)}
                    {data.breakdown.deductions.every((l: any) => l.amount === 0) && <p className="text-sm text-gray-400 py-1.5">No deductions in these runs.</p>}
                    <Line strong label="Total Deductions" amount={data.breakdown.deductions_total} />
                    <Line strong label="Net Pay (Gross − Deductions)" amount={data.breakdown.net} />
                    {data.breakdown.time_deductions > 0 && <p className="text-[11px] text-gray-400 mt-2">Of the deductions, {peso(data.breakdown.time_deductions)} is unpaid time (late, undertime, absences). Gross pay above is the recorded pre-deduction amount, so expense is not reduced by it.</p>}
                  </div>
                </div>
              </Section>

              {/* Departments */}
              <Section id="sec-departments" title="Payroll Cost by Department" hint="Click a department to filter the employee table">
                <div className="space-y-2.5">
                  {data.departments.map((d: any) => (
                    <button key={d.department} type="button" onClick={() => { setTableDept(d.department); setOtOnly(false); scrollTo('sec-employees'); }} className="w-full text-left group">
                      <div className="flex justify-between gap-3 text-sm">
                        <span className="font-medium text-gray-800 group-hover:text-orange-600">{d.department} <span className="text-xs text-gray-400 font-normal">· {d.employees} employee{d.employees === 1 ? '' : 's'}</span></span>
                        <span className="tabular-nums whitespace-nowrap"><b className="text-gray-900">{peso(d.total_expense)}</b> <span className="text-xs text-gray-400 ml-1">{pct(d.percent)}</span></span>
                      </div>
                      <div className="mt-1 h-2 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full bg-orange-400" style={{ width: `${Math.max(2, Math.min(100, d.percent))}%` }} /></div>
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-gray-400 mt-3">Department is the one recorded on each payroll record, so a later transfer does not change past months.</p>
              </Section>

              {/* Overtime */}
              <Section id="sec-overtime" title="Overtime Monitoring" hint="Approved overtime only — for cost tracking">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  {[['Total OT Hours', `${data.overtime.hours.toLocaleString('en-PH', { maximumFractionDigits: 2 })} hrs`], ['Total OT Cost', peso(data.overtime.cost)], ['Employees with OT', String(data.overtime.employees_with_ot)], ['Average OT Cost / Employee', peso(data.overtime.avg_cost_per_employee)]].map(([l, v]) => (
                    <div key={l} className="rounded-lg bg-gray-50 p-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{l}</p><p className="mt-1 text-lg font-bold tabular-nums text-gray-900">{v}</p></div>
                  ))}
                </div>
                {data.overtime.top.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Highest overtime cost</p>
                    {data.overtime.top.map((t: any) => (
                      <div key={t.employee_id} className="flex justify-between gap-3 py-1.5 text-sm border-b border-gray-50"><span className="text-gray-700">{t.name} <span className="text-xs text-gray-400">· {t.department}</span></span><span className="tabular-nums whitespace-nowrap text-gray-900 font-semibold">{peso(t.cost)} <span className="text-xs text-gray-400 font-normal">· {t.hours} hrs</span></span></div>
                    ))}
                    <button type="button" className="text-xs font-medium text-orange-600 hover:text-orange-800 mt-2" onClick={() => { setOtOnly(true); scrollTo('sec-employees'); }}>List all employees with overtime →</button>
                  </div>
                )}
              </Section>

              {/* Allowances */}
              <Section id="sec-allowances" title="Allowances and Bonuses" hint="Recurring allowance from the employee record; bonuses from manual adjustments">
                <Line label="Recurring allowances" amount={data.allowances.recurring_allowance} />
                {data.allowances.bonuses.filter((b: any) => b.amount !== 0).map((b: any) => <Line key={b.key} label={b.label} amount={b.amount} />)}
                {data.allowances.bonuses.every((b: any) => b.amount === 0) && <p className="text-sm text-gray-400 py-1.5">No bonuses or other earnings added in these runs.</p>}
                <Line strong label="Total Allowances / Bonuses" amount={data.allowances.total} />
              </Section>

              {/* Employer contributions */}
              <Section id="sec-contributions" title="Employer Contributions" hint="Company-paid share, separate from what employees pay from their own salary">
                {data.breakdown.employer.map((l: any) => <Line key={l.key} label={l.label} amount={l.amount} muted={l.amount === 0} />)}
                <Line strong label="Total Employer Contributions" amount={data.breakdown.employer_total} />
                <p className="text-[11px] text-gray-400 mt-2">Employee shares withheld from salary (SSS {peso(data.breakdown.deductions.find((x: any) => x.key === 'sss_ee')?.amount ?? 0)}, PhilHealth {peso(data.breakdown.deductions.find((x: any) => x.key === 'philhealth_ee')?.amount ?? 0)}, Pag-IBIG {peso(data.breakdown.deductions.find((x: any) => x.key === 'pagibig_ee')?.amount ?? 0)}) are not part of this.</p>
              </Section>

              {/* Runs */}
              <Section id="sec-runs" title="Payroll Runs Included" hint="Click a run to open it">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="runs">
                    <thead><tr className="border-b border-gray-100"><th className="table-header">Payroll run</th><th className="table-header">Schedule</th><th className="table-header">Pay date</th><th className="table-header">Status</th><th className="table-header text-right">Employees</th><th className="table-header text-right">Gross</th><th className="table-header text-right">Net</th><th className="table-header text-right">Employer</th><th className="table-header text-right">Total expense</th></tr></thead>
                    <tbody className="divide-y divide-gray-50">
                      {data.runs.map((r: any) => (
                        <tr key={r.id} className="hover:bg-gray-50/60">
                          <td className="table-cell"><Link href={`/payroll?period=${r.id}`} className="font-medium text-orange-600 hover:text-orange-800">{fmtDate(r.from_date)} – {fmtDate(r.to_date)}</Link></td>
                          <td className="table-cell">{r.schedule ? `Schedule ${r.schedule}` : '—'}</td><td className="table-cell whitespace-nowrap">{fmtDate(r.pay_date)}</td>
                          <td className="table-cell"><span className={(STATUS_BADGE[r.status] ?? ['', 'badge-gray'])[1]}>{(STATUS_BADGE[r.status] ?? [r.status])[0]}</span></td>
                          <td className="table-cell text-right tabular-nums">{r.employees}</td><td className="table-cell text-right tabular-nums">{peso(r.gross)}</td><td className="table-cell text-right tabular-nums">{peso(r.net)}</td>
                          <td className="table-cell text-right tabular-nums">{peso(r.employer)}</td><td className="table-cell text-right tabular-nums font-semibold">{peso(r.total_expense)}</td>
                        </tr>
                      ))}
                      <tr className="bg-gray-50 font-bold"><td className="table-cell" colSpan={5}>Monthly Total</td><td className="table-cell text-right tabular-nums">{peso(s.gross_pay)}</td><td className="table-cell text-right tabular-nums">{peso(s.net_salaries)}</td><td className="table-cell text-right tabular-nums">{peso(s.employer_contributions)}</td><td className="table-cell text-right tabular-nums">{peso(s.total_expense)}</td></tr>
                    </tbody>
                  </table>
                </div>
              </Section>

              {/* Employees */}
              <Section id="sec-employees" title="Employee Cost Breakdown" hint="Click a column to sort · Total Employer Cost = Gross Pay + Employer Contributions">
                {(otOnly || tableDept) && (
                  <div className="flex flex-wrap gap-2 mb-3 print:hidden">
                    {otOnly && <button type="button" onClick={() => setOtOnly(false)} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-orange-50 text-orange-700 border border-orange-200">With overtime <X size={12} /></button>}
                    {tableDept && <button type="button" onClick={() => setTableDept('')} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-orange-50 text-orange-700 border border-orange-200">{tableDept} <X size={12} /></button>}
                  </div>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="employees">
                    <thead><tr className="border-b border-gray-100">
                      <Th k="name" label="Employee" /><Th k="department" label="Department" /><Th k="basic" label="Basic Pay" right /><Th k="overtime" label="Overtime" right /><Th k="allowances" label="Allowances" right />
                      <Th k="gross" label="Gross Pay" right /><Th k="employer" label="Employer Contrib." right /><Th k="net" label="Net Pay" right /><Th k="total_cost" label="Total Employer Cost" right />
                    </tr></thead>
                    <tbody className="divide-y divide-gray-50">
                      {rows.map((e: any) => (
                        <tr key={e.employee_id} className="hover:bg-gray-50/60">
                          <td className="table-cell"><p className="font-medium text-gray-900">{e.name}</p><p className="text-[11px] text-gray-400">{e.code}{e.pay_basis === 'fixed' ? ' · Fixed rate' : ''}{e.runs > 1 ? ` · ${e.runs} runs` : ''}</p></td>
                          <td className="table-cell">{e.department}</td>
                          <td className="table-cell text-right tabular-nums">{peso(e.basic)}</td><td className="table-cell text-right tabular-nums">{peso(e.overtime)}</td><td className="table-cell text-right tabular-nums">{peso(e.allowances)}</td>
                          <td className="table-cell text-right tabular-nums">{peso(e.gross)}</td><td className="table-cell text-right tabular-nums">{peso(e.employer)}</td><td className="table-cell text-right tabular-nums">{peso(e.net)}</td>
                          <td className="table-cell text-right tabular-nums font-bold">{peso(e.total_cost)}</td>
                        </tr>
                      ))}
                      {rows.length === 0 && <tr><td colSpan={9} className="table-cell text-center text-gray-400 py-8">No employees match this filter.</td></tr>}
                      {rows.length > 0 && (
                        <tr className="bg-gray-50 font-bold" data-testid="employees-total"><td className="table-cell" colSpan={2}>Total{rows.length !== data.employees.length ? ' (filtered)' : ''}</td>
                          {(['basic', 'overtime', 'allowances', 'gross', 'employer', 'net', 'total_cost'] as const).map(k => <td key={k} className="table-cell text-right tabular-nums">{peso(rows.reduce((sum: number, r: any) => sum + r[k], 0))}</td>)}</tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Section>

              {/* Data checks */}
              <Section id="sec-checks" title="Data Checks" hint="Every total on this page is cross-checked against the payroll records">
                <button type="button" onClick={() => setShowChecks(v => !v)} className="text-sm flex items-center gap-2 print:hidden">
                  {problems.length === 0 ? <><CheckCircle2 size={16} className="text-emerald-600" /><span className="text-emerald-700 font-medium">All {data.checks.length} checks passed</span></> : <><AlertTriangle size={16} className="text-amber-600" /><span className="text-amber-700 font-medium">{problems.length} of {data.checks.length} checks need attention</span></>}
                  <span className="text-xs text-gray-400">{showChecks ? 'Hide' : 'Show'} details</span>
                </button>
                <ul className={`mt-3 space-y-2 ${showChecks || problems.length > 0 ? '' : 'hidden print:block'}`}>
                  {data.checks.map((c: any) => (
                    <li key={c.code} className="text-sm flex gap-2">
                      {c.severity === 'ok' ? <CheckCircle2 size={15} className="text-emerald-600 shrink-0 mt-0.5" /> : <AlertTriangle size={15} className={`${c.severity === 'error' ? 'text-red-600' : 'text-amber-600'} shrink-0 mt-0.5`} />}
                      <div><p className="font-medium text-gray-800">{c.title}</p><p className="text-xs text-gray-500">{c.message}</p>
                        {c.details.length > 0 && <ul className="mt-1 text-xs text-gray-500 list-disc pl-4">{c.details.slice(0, 8).map((d: string) => <li key={d}>{d}</li>)}{c.details.length > 8 && <li>…and {c.details.length - 8} more</li>}</ul>}</div>
                    </li>
                  ))}
                </ul>
              </Section>
            </>
          )}
        </div>
      )}

      <style jsx global>{`
        @media print {
          @page { size: A4 landscape; margin: 10mm; }
          /* the app shell scrolls inside a fixed-height box; let the report flow onto pages instead */
          aside, button.fixed { display: none !important; }
          .h-screen { height: auto !important; }
          .overflow-hidden, .overflow-auto { overflow: visible !important; }
          main { padding-top: 0 !important; }
          body { background: #fff !important; }
          .mpe-root { padding: 0 !important; }
          .card { box-shadow: none !important; break-inside: avoid; page-break-inside: avoid; }
          tr { break-inside: avoid; }
          .mpe-root * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
    </div>
  );
}
