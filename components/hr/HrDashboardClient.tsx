'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Users, Clock3, AlertTriangle, Coffee, FileEdit, Palmtree, AlertCircle, ChevronDown, X } from 'lucide-react';
import { formatDate, todayISO } from '@/lib/utils';
import { resolvePeriod, PERIOD_OPTIONS, type PeriodKey } from '@/lib/marketing-analytics';
import { Toast, useToast } from '@/components/ui/Toast';
import { OtReviewModal, CorrectionReviewModal } from '@/components/attendance/AttendanceAdminClient';
import { LeaveReviewModal } from '@/components/leave/LeaveManagementClient';

const REFRESH_MS = 45_000;

interface PersonRow { employee_id: number; name: string; date: string; lateMinutes?: number; }
type CardKey = 'present' | 'late' | 'absent' | 'onBreak';

// The everyday landing view for HR/Owner — deliberately just 4 numbers plus
// a single "here's what needs a decision" panel. Everything technical
// (shift templates, break rules, holiday calendar, leave types, test mode)
// lives in HR Settings instead — this page never shows a formula or a
// config field, only outcomes and actions.
export default function HrDashboardClient() {
  const router = useRouter();
  const { toast, showToast, clearToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [presentList, setPresentList] = useState<PersonRow[]>([]);
  const [lateList, setLateList] = useState<PersonRow[]>([]);
  const [absentList, setAbsentList] = useState<PersonRow[]>([]);
  const [onBreakList, setOnBreakList] = useState<PersonRow[]>([]);
  const [expandedCard, setExpandedCard] = useState<CardKey | null>(null);
  const [attention, setAttention] = useState<{ pendingOt: any[]; pendingCorrections: any[]; pendingLeave: any[]; missingTimeOut: any[] }>({
    pendingOt: [], pendingCorrections: [], pendingLeave: [], missingTimeOut: [],
  });
  const [reviewingOt, setReviewingOt] = useState<any | null>(null);
  const [reviewingCorrection, setReviewingCorrection] = useState<any | null>(null);
  const [reviewingLeave, setReviewingLeave] = useState<any | null>(null);

  // Present/Late/Absent are date-ranged (Today/Yesterday/Last Week/...);
  // On Break and Needs Your Attention are inherently "right now" concepts —
  // there's no such thing as "on break yesterday" — so they stay live/
  // current regardless of this filter (see the On Break card below, which
  // only shows a number when period === 'today').
  const [period, setPeriod] = useState<PeriodKey>('today');
  const [customFrom, setCustomFrom] = useState(todayISO());
  const [customTo, setCustomTo] = useState(todayISO());
  const [appliedCustom, setAppliedCustom] = useState({ from: todayISO(), to: todayISO() });

  const range = useMemo(
    () => resolvePeriod(period, todayISO(), appliedCustom.from, appliedCustom.to),
    [period, appliedCustom]
  );
  const periodLabel = PERIOD_OPTIONS.find(o => o.key === period)?.label ?? 'Today';

  const fetchAll = () => {
    Promise.all([
      fetch(`/api/attendance/records?from=${range.from}&to=${range.to}`).then(r => r.json()),
      fetch('/api/attendance/live-status').then(r => r.json()),
      fetch('/api/hr/needs-attention').then(r => r.json()),
    ]).then(([records, live, needsAttention]) => {
      const rows = Array.isArray(records) ? records : [];
      const toPerson = (r: any): PersonRow => ({ employee_id: r.employee_id, name: r.name, date: r.date, lateMinutes: r.lateMinutes });
      setPresentList(rows.filter((r: any) => r.status === 'present').map(toPerson));
      setLateList(rows.filter((r: any) => r.status === 'late').map(toPerson));
      setAbsentList(rows.filter((r: any) => r.status === 'absent').map(toPerson));
      setOnBreakList(
        (live?.employees ?? [])
          .filter((e: any) => e.state === 'on_lunch' || e.state === 'on_coffee')
          .map((e: any): PersonRow => ({ employee_id: e.employee_id, name: e.name, date: todayISO() }))
      );
      setAttention({
        pendingOt: needsAttention.pendingOt ?? [],
        pendingCorrections: needsAttention.pendingCorrections ?? [],
        pendingLeave: needsAttention.pendingLeave ?? [],
        missingTimeOut: needsAttention.missingTimeOut ?? [],
      });
      setLoading(false);
    });
  };

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, REFRESH_MS);
    return () => clearInterval(id);
  }, [range.from, range.to]);

  const totalAttention = attention.pendingOt.length + attention.pendingCorrections.length + attention.pendingLeave.length + attention.missingTimeOut.length;

  if (loading) return <div className="flex justify-center py-24"><Loader2 className="animate-spin text-gray-300" size={24} /></div>;

  const cards: { key: CardKey; label: string; value: number | null; icon: typeof Users; color: string; list: PersonRow[] }[] = [
    { key: 'present', label: `Present ${periodLabel}`, value: presentList.length, icon: Users, color: 'text-green-600 bg-green-50', list: presentList },
    { key: 'late', label: `Late ${periodLabel}`, value: lateList.length, icon: Clock3, color: 'text-amber-600 bg-amber-50', list: lateList },
    { key: 'absent', label: `Absent ${periodLabel}`, value: absentList.length, icon: AlertTriangle, color: 'text-red-600 bg-red-50', list: absentList },
    { key: 'onBreak', label: 'On Break', value: period === 'today' ? onBreakList.length : null, icon: Coffee, color: 'text-orange-600 bg-orange-50', list: onBreakList },
  ];
  const expanded = cards.find(c => c.key === expandedCard) ?? null;
  const multiDay = range.from !== range.to;

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}

      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">HR Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">{periodLabel} at a glance</p>
        </div>

        <div className="flex flex-col items-end gap-2">
          <select
            value={period}
            onChange={e => setPeriod(e.target.value as PeriodKey)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2.5 bg-white text-gray-900 focus:outline-none focus:ring-1 focus:ring-orange-400"
          >
            {PERIOD_OPTIONS.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
          </select>
          {period === 'custom' && (
            <div className="flex items-center flex-wrap gap-2">
              <input type="date" value={customFrom} max={customTo} onChange={e => setCustomFrom(e.target.value)} className="text-xs border border-gray-200 rounded-md px-2 py-1.5" />
              <span className="text-gray-300 text-xs">to</span>
              <input type="date" value={customTo} min={customFrom} max={todayISO()} onChange={e => setCustomTo(e.target.value)} className="text-xs border border-gray-200 rounded-md px-2 py-1.5" />
              <button
                onClick={() => setAppliedCustom({ from: customFrom, to: customTo })}
                className="text-xs font-semibold text-white bg-orange-500 hover:bg-orange-600 rounded-md px-3 py-1.5"
              >
                Apply
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {cards.map(c => {
          const disabled = c.value === null;
          const isExpanded = expandedCard === c.key;
          return (
            <button
              key={c.key}
              disabled={disabled}
              onClick={() => setExpandedCard(k => (k === c.key ? null : c.key))}
              className={`card flex items-center gap-4 text-left transition-colors ${
                disabled ? 'cursor-default' : 'cursor-pointer hover:bg-gray-50'
              } ${isExpanded ? 'ring-2 ring-orange-300' : ''}`}
            >
              <div className={`p-3 rounded-xl ${c.color}`}><c.icon size={22} /></div>
              <div className="flex-1">
                <p className="text-xs text-gray-500 font-medium">{c.label}</p>
                <p className="text-xl font-bold text-gray-900 mt-0.5">{c.value === null ? '—' : c.value}</p>
                {c.value === null && <p className="text-[10px] text-gray-400 mt-0.5">Only shown for &quot;Today&quot;</p>}
              </div>
              {!disabled && <ChevronDown size={16} className={`text-gray-300 shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />}
            </button>
          );
        })}
      </div>

      {expanded && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-900">{expanded.label} — {expanded.list.length} employee{expanded.list.length === 1 ? '' : 's'}</p>
            <button onClick={() => setExpandedCard(null)} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
          </div>
          {expanded.list.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No employees in this list.</p>
          ) : (
            <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-1.5">
              {expanded.list.map((p, i) => (
                <div key={`${p.employee_id}-${p.date}-${i}`} className="flex items-center justify-between gap-2 bg-gray-50 rounded-lg px-3 py-2">
                  <span className="text-sm text-gray-700 truncate">{p.name}</span>
                  <span className="text-xs text-gray-400 shrink-0">
                    {expanded.key === 'late' && p.lateMinutes ? `${p.lateMinutes}m` : ''}
                    {multiDay ? (expanded.key === 'late' && p.lateMinutes ? ` · ${formatDate(p.date)}` : formatDate(p.date)) : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="card space-y-4 border-2 border-orange-100">
        <div className="flex items-center justify-between">
          <p className="text-base font-semibold text-gray-900">Needs Your Attention</p>
          {totalAttention > 0 && <span className="badge-amber">{totalAttention}</span>}
        </div>

        {totalAttention === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">Nothing needs your attention right now.</p>
        ) : (
          <div className="space-y-1.5">
            {attention.pendingOt.map((r: any) => (
              <button key={`ot-${r.id}`} onClick={() => setReviewingOt(r)} className="w-full flex items-center justify-between text-left bg-gray-50 hover:bg-gray-100 rounded-lg px-3.5 py-2.5 transition-colors">
                <span className="flex items-center gap-2 text-sm text-gray-700">
                  <Clock3 size={14} className="text-orange-500 shrink-0" />
                  OT for Approval — {r.employee_name} ({formatDate(r.event_date)})
                </span>
                <span className="text-xs text-orange-600 font-medium">Review →</span>
              </button>
            ))}
            {attention.pendingCorrections.map((r: any) => (
              <button key={`corr-${r.id}`} onClick={() => setReviewingCorrection(r)} className="w-full flex items-center justify-between text-left bg-gray-50 hover:bg-gray-100 rounded-lg px-3.5 py-2.5 transition-colors">
                <span className="flex items-center gap-2 text-sm text-gray-700">
                  <FileEdit size={14} className="text-blue-500 shrink-0" />
                  Attendance Correction — {r.employee_name} ({formatDate(r.event_date)})
                </span>
                <span className="text-xs text-orange-600 font-medium">Review →</span>
              </button>
            ))}
            {attention.pendingLeave.map((r: any) => (
              <button key={`leave-${r.id}`} onClick={() => setReviewingLeave(r)} className="w-full flex items-center justify-between text-left bg-gray-50 hover:bg-gray-100 rounded-lg px-3.5 py-2.5 transition-colors">
                <span className="flex items-center gap-2 text-sm text-gray-700">
                  <Palmtree size={14} className="text-green-500 shrink-0" />
                  Leave Request — {r.employee_name} ({r.leave_type_name})
                </span>
                <span className="text-xs text-orange-600 font-medium">Review →</span>
              </button>
            ))}
            {attention.missingTimeOut.map((r: any) => (
              <div key={`missing-${r.employee_id}`} onClick={() => router.push('/attendance')} className="w-full flex items-center justify-between text-left bg-gray-50 hover:bg-gray-100 rounded-lg px-3.5 py-2.5 transition-colors cursor-pointer">
                <span className="flex items-center gap-2 text-sm text-gray-700">
                  <AlertCircle size={14} className="text-red-500 shrink-0" />
                  Missing Time Out — {r.employee_name} (today)
                </span>
                <span className="text-xs text-gray-400 font-medium">View →</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {reviewingOt && (
        <OtReviewModal request={reviewingOt} onClose={() => setReviewingOt(null)} onDone={() => { setReviewingOt(null); showToast('OT request reviewed!'); fetchAll(); }} />
      )}
      {reviewingCorrection && (
        <CorrectionReviewModal request={reviewingCorrection} onClose={() => setReviewingCorrection(null)} onDone={() => { setReviewingCorrection(null); showToast('Correction reviewed!'); fetchAll(); }} />
      )}
      {reviewingLeave && (
        <LeaveReviewModal request={reviewingLeave} onClose={() => setReviewingLeave(null)} onDone={() => { setReviewingLeave(null); showToast('Leave request reviewed!'); fetchAll(); }} />
      )}
    </div>
  );
}
