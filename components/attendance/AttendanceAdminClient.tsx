'use client';

import { useEffect, useState } from 'react';
import { Loader2, Users, AlertTriangle, Clock3, FileEdit, CalendarClock, FlaskConical, Trash2, Plus } from 'lucide-react';
import { formatDate, todayISO } from '@/lib/utils';
import { Toast, useToast } from '@/components/ui/Toast';
import type { EventType, AttendanceStatus } from '@/lib/attendance';

type Tab = 'dashboard' | 'settings' | 'records' | 'ot' | 'corrections' | 'test';

const TABS: { key: Tab; label: string }[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'settings', label: 'Settings' },
  { key: 'records', label: 'Daily Records' },
  { key: 'ot', label: 'OT Approval' },
  { key: 'corrections', label: 'Correction Requests' },
  { key: 'test', label: 'Test Mode' },
];

const STATUS_BADGE: Record<AttendanceStatus, string> = {
  not_started: 'badge-gray',
  present: 'badge-green',
  late: 'badge-amber',
  absent: 'badge-red',
  half_day: 'badge-amber',
  undertime: 'badge-amber',
};

const STATUS_LABEL: Record<AttendanceStatus, string> = {
  not_started: 'Not Clocked In',
  present: 'Present',
  late: 'Late',
  absent: 'Absent',
  half_day: 'Half Day',
  undertime: 'Undertime',
};

const EVENT_LABELS: Record<EventType, string> = {
  TIME_IN: 'Work Time In',
  COFFEE_OUT: 'Coffee Break Out',
  COFFEE_IN: 'Coffee Break In',
  LUNCH_OUT: 'Lunch Break Out',
  LUNCH_IN: 'Lunch Break In',
  TIME_OUT: 'Work Time Out',
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function fmtMinutes(m: number) {
  const h = Math.floor(m / 60), mm = m % 60;
  return h > 0 ? `${h}h ${mm}m` : `${mm}m`;
}

export default function AttendanceAdminClient() {
  const { toast, showToast, clearToast } = useToast();
  const [tab, setTab] = useState<Tab>('dashboard');

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}

      <div>
        <h1 className="text-2xl font-bold text-gray-900">Attendance Admin</h1>
        <p className="text-sm text-gray-500 mt-1">Shift rules, daily records, overtime, and correction approvals</p>
      </div>

      <div className="flex gap-1 flex-wrap">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              tab === t.key ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'dashboard' && <DashboardTab />}
      {tab === 'settings' && <SettingsTab showToast={showToast} />}
      {tab === 'records' && <RecordsTab />}
      {tab === 'ot' && <OtTab showToast={showToast} />}
      {tab === 'corrections' && <CorrectionsTab showToast={showToast} />}
      {tab === 'test' && <TestModeTab showToast={showToast} />}
    </div>
  );
}

// ── Dashboard ────────────────────────────────────────────────────────────

const DASHBOARD_REFRESH_MS = 45_000;

function DashboardTab() {
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [counts, setCounts] = useState({ present: 0, late: 0, absent: 0, notStarted: 0, pendingOt: 0, pendingCorrections: 0 });
  // Live "what's happening right now" counts — a separate axis from the
  // shift-status counts above. Each employee's dayState.state is a single
  // value, so an employee is counted in exactly one of working/onBreak/
  // clockedOut/notStarted here, never two, same guarantee as the
  // status-based counts (each computeDaySummary() call returns one status).
  const [liveCounts, setLiveCounts] = useState({ working: 0, onBreak: 0, clockedOut: 0 });

  const fetchDashboard = () => {
    const today = todayISO();
    Promise.all([
      fetch(`/api/attendance/records?from=${today}&to=${today}`).then(r => r.json()),
      fetch('/api/attendance/ot-requests?status=pending').then(r => r.json()),
      fetch('/api/attendance/corrections?status=pending').then(r => r.json()),
      fetch('/api/attendance/live-status').then(r => r.json()),
    ]).then(([records, ot, corrections, live]) => {
      const rows = Array.isArray(records) ? records : [];
      setCounts({
        present: rows.filter((r: any) => r.status === 'present').length,
        late: rows.filter((r: any) => r.status === 'late').length,
        absent: rows.filter((r: any) => r.status === 'absent').length,
        notStarted: rows.filter((r: any) => r.status === 'not_started').length,
        pendingOt: Array.isArray(ot) ? ot.length : 0,
        pendingCorrections: Array.isArray(corrections) ? corrections.length : 0,
      });
      if (live?.counts) setLiveCounts({ working: live.counts.working, onBreak: live.counts.onBreak, clockedOut: live.counts.clockedOut });
      setLastUpdated(new Date());
      setLoading(false);
    });
  };

  useEffect(() => {
    fetchDashboard();
    const id = setInterval(fetchDashboard, DASHBOARD_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-300" size={24} /></div>;

  const shiftStatusCards = [
    { label: 'Present Today', value: counts.present, icon: Users, color: 'text-green-600 bg-green-50' },
    { label: 'Late Today', value: counts.late, icon: Clock3, color: 'text-amber-600 bg-amber-50' },
    { label: 'Absent Today', value: counts.absent, icon: AlertTriangle, color: 'text-red-600 bg-red-50' },
    { label: 'Not Clocked In Yet', value: counts.notStarted, icon: CalendarClock, color: 'text-gray-500 bg-gray-50' },
    { label: 'Pending OT Requests', value: counts.pendingOt, icon: Clock3, color: 'text-orange-600 bg-orange-50' },
    { label: 'Pending Corrections', value: counts.pendingCorrections, icon: FileEdit, color: 'text-blue-600 bg-blue-50' },
  ];

  const liveCards = [
    { label: 'Currently Working', value: liveCounts.working, icon: Users, color: 'text-green-600 bg-green-50' },
    { label: 'Currently On Break', value: liveCounts.onBreak, icon: Clock3, color: 'text-amber-600 bg-amber-50' },
    { label: 'Clocked Out Today', value: liveCounts.clockedOut, icon: CalendarClock, color: 'text-gray-500 bg-gray-50' },
  ];

  return (
    <div className="space-y-6">
      {lastUpdated && (
        <p className="text-xs text-gray-400 text-right">
          Updated {lastUpdated.toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit', second: '2-digit' })} · auto-refreshes every 45s
        </p>
      )}

      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Right Now</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {liveCards.map(c => (
            <div key={c.label} className="card flex items-center gap-4">
              <div className={`p-3 rounded-xl ${c.color}`}><c.icon size={22} /></div>
              <div>
                <p className="text-xs text-gray-500 font-medium">{c.label}</p>
                <p className="text-xl font-bold text-gray-900 mt-0.5">{c.value}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Today's Shift Status</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {shiftStatusCards.map(c => (
            <div key={c.label} className="card flex items-center gap-4">
              <div className={`p-3 rounded-xl ${c.color}`}><c.icon size={22} /></div>
              <div>
                <p className="text-xs text-gray-500 font-medium">{c.label}</p>
                <p className="text-xl font-bold text-gray-900 mt-0.5">{c.value}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Settings ─────────────────────────────────────────────────────────────

interface Settings {
  work_start: string; work_end: string; grace_period_minutes: number;
  lunch_break_minutes: number; coffee_break_minutes: number; coffee_breaks_allowed: number;
  lunch_break_paid: boolean; coffee_break_paid: boolean;
  min_minutes_before_ot: number; selfie_required: boolean; work_days: number[];
}

function SettingsTab({ showToast }: { showToast: (m: string, t?: 'success' | 'error') => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/attendance/settings').then(r => r.json()).then(d => { setSettings(d); setLoading(false); });
  }, []);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const res = await fetch('/api/attendance/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (res.ok) showToast('Settings saved!');
      else showToast('Failed to save settings.', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !settings) return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-300" size={24} /></div>;

  const toggleWorkDay = (dow: number) => {
    setSettings(s => s ? {
      ...s,
      work_days: s.work_days.includes(dow) ? s.work_days.filter(d => d !== dow) : [...s.work_days, dow].sort(),
    } : s);
  };

  return (
    <div className="card space-y-5 max-w-2xl">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="form-label">Work Start Time</label>
          <input type="time" className="form-input" value={settings.work_start} onChange={e => setSettings({ ...settings, work_start: e.target.value })} />
        </div>
        <div>
          <label className="form-label">Work End Time</label>
          <input type="time" className="form-input" value={settings.work_end} onChange={e => setSettings({ ...settings, work_end: e.target.value })} />
        </div>
        <div>
          <label className="form-label">Grace Period (minutes)</label>
          <input type="number" className="form-input" value={settings.grace_period_minutes} onChange={e => setSettings({ ...settings, grace_period_minutes: Number(e.target.value) })} />
        </div>
        <div>
          <label className="form-label">Min. Minutes Before OT Eligible</label>
          <input type="number" className="form-input" value={settings.min_minutes_before_ot} onChange={e => setSettings({ ...settings, min_minutes_before_ot: Number(e.target.value) })} />
        </div>
      </div>

      <div className="border-t border-gray-100 pt-4 grid grid-cols-2 gap-4">
        <div>
          <label className="form-label">Lunch Break Duration (minutes)</label>
          <input type="number" className="form-input" value={settings.lunch_break_minutes} onChange={e => setSettings({ ...settings, lunch_break_minutes: Number(e.target.value) })} />
        </div>
        <div>
          <label className="form-label">Lunch Break</label>
          <select className="form-input" value={settings.lunch_break_paid ? '1' : '0'} onChange={e => setSettings({ ...settings, lunch_break_paid: e.target.value === '1' })}>
            <option value="0">Unpaid</option>
            <option value="1">Paid (only excess deducted)</option>
          </select>
        </div>
        <div>
          <label className="form-label">Coffee Break Duration (minutes)</label>
          <input type="number" className="form-input" value={settings.coffee_break_minutes} onChange={e => setSettings({ ...settings, coffee_break_minutes: Number(e.target.value) })} />
        </div>
        <div>
          <label className="form-label">Coffee Break</label>
          <select className="form-input" value={settings.coffee_break_paid ? '1' : '0'} onChange={e => setSettings({ ...settings, coffee_break_paid: e.target.value === '1' })}>
            <option value="0">Unpaid</option>
            <option value="1">Paid (only excess deducted)</option>
          </select>
        </div>
        <div>
          <label className="form-label">Allowed Coffee Breaks / Day</label>
          <input type="number" min={0} className="form-input" value={settings.coffee_breaks_allowed} onChange={e => setSettings({ ...settings, coffee_breaks_allowed: Number(e.target.value) })} />
        </div>
      </div>

      <div className="border-t border-gray-100 pt-4">
        <label className="form-label">Selfie Required for Work Time In / Time Out</label>
        <p className="text-xs text-gray-400 mb-2">Coffee and Lunch breaks never require a selfie.</p>
        <select className="form-input max-w-xs" value={settings.selfie_required ? '1' : '0'} onChange={e => setSettings({ ...settings, selfie_required: e.target.value === '1' })}>
          <option value="1">Required</option>
          <option value="0">Not Required</option>
        </select>
      </div>

      <div className="border-t border-gray-100 pt-4">
        <label className="form-label">Work Days</label>
        <div className="flex gap-1.5 flex-wrap">
          {WEEKDAYS.map((d, i) => (
            <button
              key={d}
              onClick={() => toggleWorkDay(i)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                settings.work_days.includes(i) ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <button onClick={save} disabled={saving} className="btn-primary disabled:opacity-50">
          {saving ? <Loader2 size={14} className="animate-spin" /> : null}
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}

// ── Daily Records ────────────────────────────────────────────────────────

function RecordsTab() {
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [employees, setEmployees] = useState<{ id: number; name: string }[]>([]);
  const [userId, setUserId] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/attendance/employees').then(r => r.json()).then(d => setEmployees(Array.isArray(d) ? d : []));
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ from, to });
    if (userId) params.set('user_id', userId);
    fetch(`/api/attendance/records?${params}`).then(r => r.json()).then(d => { setRows(Array.isArray(d) ? d : []); setLoading(false); });
  }, [from, to, userId]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="form-label">From</label>
          <input type="date" className="form-input py-1.5 text-sm w-auto" value={from} onChange={e => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="form-label">To</label>
          <input type="date" className="form-input py-1.5 text-sm w-auto" value={to} onChange={e => setTo(e.target.value)} />
        </div>
        <div>
          <label className="form-label">Employee</label>
          <select className="form-input py-1.5 text-sm w-auto" value={userId} onChange={e => setUserId(e.target.value)}>
            <option value="">All Employees</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-300" size={24} /></div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-12">No records for this range.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="table-header">Date</th>
                  <th className="table-header">Employee</th>
                  <th className="table-header">Status</th>
                  <th className="table-header">Work Hours</th>
                  <th className="table-header">Break</th>
                  <th className="table-header">Excess Break</th>
                  <th className="table-header">Late</th>
                  <th className="table-header">Undertime</th>
                  <th className="table-header">Potential OT</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((r, i) => (
                  <tr key={i} className="hover:bg-gray-50/60">
                    <td className="table-cell">{formatDate(r.date)}</td>
                    <td className="table-cell">{r.name}</td>
                    <td className="table-cell"><span className={STATUS_BADGE[r.status as AttendanceStatus]}>{STATUS_LABEL[r.status as AttendanceStatus]}</span></td>
                    <td className="table-cell">{fmtMinutes(r.totalWorkMinutes)}</td>
                    <td className="table-cell">{fmtMinutes(r.breakMinutes)}</td>
                    <td className="table-cell">{r.excessBreakMinutes > 0 ? fmtMinutes(r.excessBreakMinutes) : '—'}</td>
                    <td className="table-cell">{r.lateMinutes > 0 ? fmtMinutes(r.lateMinutes) : '—'}</td>
                    <td className="table-cell">{r.undertimeMinutes > 0 ? fmtMinutes(r.undertimeMinutes) : '—'}</td>
                    <td className="table-cell">{r.potentialOtMinutes > 0 ? <span className="badge-blue">{fmtMinutes(r.potentialOtMinutes)} pending</span> : '—'}</td>
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

// ── OT Approval Queue ────────────────────────────────────────────────────

function OtTab({ showToast }: { showToast: (m: string, t?: 'success' | 'error') => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState<any | null>(null);

  const fetchRows = () => {
    setLoading(true);
    fetch('/api/attendance/ot-requests?status=pending').then(r => r.json()).then(d => { setRows(Array.isArray(d) ? d : []); setLoading(false); });
  };

  useEffect(fetchRows, []);

  return (
    <div className="space-y-4">
      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-300" size={24} /></div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-12">No pending OT requests.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="table-header">Date</th>
                  <th className="table-header">Employee</th>
                  <th className="table-header">Excess Time</th>
                  <th className="table-header"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map(r => (
                  <tr key={r.id} className="hover:bg-gray-50/60">
                    <td className="table-cell">{formatDate(r.event_date)}</td>
                    <td className="table-cell">{r.employee_name}</td>
                    <td className="table-cell"><span className="badge-blue">{fmtMinutes(r.excess_minutes)}</span></td>
                    <td className="table-cell text-right">
                      <button onClick={() => setReviewing(r)} className="btn-secondary text-xs py-1.5">Review</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {reviewing && (
        <OtReviewModal
          request={reviewing}
          onClose={() => setReviewing(null)}
          onDone={() => { setReviewing(null); showToast('OT request reviewed!'); fetchRows(); }}
        />
      )}
    </div>
  );
}

function OtReviewModal({ request, onClose, onDone }: { request: any; onClose: () => void; onDone: () => void }) {
  const [approvedMinutes, setApprovedMinutes] = useState(String(request.excess_minutes));
  const [remarks, setRemarks] = useState('');
  const [saving, setSaving] = useState<'approve' | 'partial_approve' | 'reject' | null>(null);

  const submit = async (action: 'approve' | 'partial_approve' | 'reject') => {
    setSaving(action);
    try {
      const body: any = { action, remarks: remarks || undefined };
      if (action === 'partial_approve') body.approved_minutes = Number(approvedMinutes);
      const res = await fetch(`/api/attendance/ot-requests/${request.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (res.ok) onDone();
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Review OT Request</h2>
        <p className="text-sm text-gray-600">
          {request.employee_name} — {formatDate(request.event_date)} — excess time worked: <b>{fmtMinutes(request.excess_minutes)}</b>
        </p>
        <div>
          <label className="form-label">Approved Minutes (for partial approval)</label>
          <input type="number" min={0} max={request.excess_minutes} className="form-input" value={approvedMinutes} onChange={e => setApprovedMinutes(e.target.value)} />
        </div>
        <div>
          <label className="form-label">Remarks</label>
          <textarea className="form-input" rows={2} value={remarks} onChange={e => setRemarks(e.target.value)} />
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={() => submit('reject')} disabled={!!saving} className="bg-red-500 hover:bg-red-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50">
            {saving === 'reject' ? <Loader2 size={14} className="animate-spin inline" /> : 'Reject'}
          </button>
          <button onClick={() => submit('partial_approve')} disabled={!!saving} className="btn-secondary disabled:opacity-50">
            {saving === 'partial_approve' ? <Loader2 size={14} className="animate-spin inline" /> : 'Approve Partial'}
          </button>
          <button onClick={() => submit('approve')} disabled={!!saving} className="btn-primary disabled:opacity-50">
            {saving === 'approve' ? <Loader2 size={14} className="animate-spin inline" /> : 'Approve Full'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Correction Requests ──────────────────────────────────────────────────

function CorrectionsTab({ showToast }: { showToast: (m: string, t?: 'success' | 'error') => void }) {
  const [statusFilter, setStatusFilter] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState<any | null>(null);

  const fetchRows = () => {
    setLoading(true);
    fetch(`/api/attendance/corrections?status=${statusFilter}`).then(r => r.json()).then(d => { setRows(Array.isArray(d) ? d : []); setLoading(false); });
  };

  useEffect(fetchRows, [statusFilter]);

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5">
        {(['pending', 'approved', 'rejected'] as const).map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors ${
              statusFilter === s ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-300" size={24} /></div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-12">No {statusFilter} correction requests.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="table-header">Date</th>
                  <th className="table-header">Employee</th>
                  <th className="table-header">Action</th>
                  <th className="table-header">Requested Time</th>
                  <th className="table-header">Reason</th>
                  <th className="table-header"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map(r => (
                  <tr key={r.id} className="hover:bg-gray-50/60">
                    <td className="table-cell">{formatDate(r.event_date)}</td>
                    <td className="table-cell">{r.employee_name}</td>
                    <td className="table-cell">{EVENT_LABELS[r.requested_event_type as EventType]}</td>
                    <td className="table-cell">{new Date(r.requested_time).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                    <td className="table-cell text-gray-500 text-xs max-w-xs truncate">{r.reason}</td>
                    <td className="table-cell text-right">
                      {r.status === 'pending' ? (
                        <button onClick={() => setReviewing(r)} className="btn-secondary text-xs py-1.5">Review</button>
                      ) : (
                        <span className={r.status === 'approved' ? 'badge-green' : 'badge-red'}>{r.status}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {reviewing && (
        <CorrectionReviewModal
          request={reviewing}
          onClose={() => setReviewing(null)}
          onDone={() => { setReviewing(null); showToast('Correction request reviewed!'); fetchRows(); }}
        />
      )}
    </div>
  );
}

function CorrectionReviewModal({ request, onClose, onDone }: { request: any; onClose: () => void; onDone: () => void }) {
  const [remarks, setRemarks] = useState('');
  const [saving, setSaving] = useState<'approve' | 'reject' | null>(null);

  const submit = async (action: 'approve' | 'reject') => {
    setSaving(action);
    try {
      const res = await fetch(`/api/attendance/corrections/${request.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, remarks: remarks || undefined }),
      });
      if (res.ok) onDone();
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Review Correction Request</h2>
        <div className="text-sm text-gray-600 space-y-1">
          <p><b>{request.employee_name}</b> — {formatDate(request.event_date)}</p>
          <p>{EVENT_LABELS[request.requested_event_type as EventType]} → {new Date(request.requested_time).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}</p>
          <p className="text-gray-400">Reason: {request.reason}</p>
        </div>
        <div>
          <label className="form-label">Remarks</label>
          <textarea className="form-input" rows={2} value={remarks} onChange={e => setRemarks(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={() => submit('reject')} disabled={!!saving} className="bg-red-500 hover:bg-red-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50">
            {saving === 'reject' ? <Loader2 size={14} className="animate-spin inline" /> : 'Reject'}
          </button>
          <button onClick={() => submit('approve')} disabled={!!saving} className="btn-primary disabled:opacity-50">
            {saving === 'approve' ? <Loader2 size={14} className="animate-spin inline" /> : 'Approve'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Test / Simulation Mode ──────────────────────────────────────────────
// Admin-only. Every row this tab creates/reads/deletes is tagged
// is_test = 1 server-side — every real read path (Dashboard, Daily
// Records, the employee's own My Attendance page, and both background
// jobs) explicitly filters is_test = 0, so nothing simulated here can ever
// reach a real report, a real employee's record, or an OT/payroll-ready
// total. See app/api/attendance/test/{events,summary}/route.ts.

function TestModeTab({ showToast }: { showToast: (m: string, t?: 'success' | 'error') => void }) {
  const [employees, setEmployees] = useState<{ id: number; name: string }[]>([]);
  const [userId, setUserId] = useState('');
  const [date, setDate] = useState(todayISO());
  const [events, setEvents] = useState<any[]>([]);
  const [summary, setSummary] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [eventType, setEventType] = useState<EventType>('TIME_IN');
  const [time, setTime] = useState('09:00');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    fetch('/api/attendance/employees').then(r => r.json()).then(d => setEmployees(Array.isArray(d) ? d : []));
  }, []);

  const fetchAll = () => {
    if (!userId || !date) { setEvents([]); setSummary(null); return; }
    setLoading(true);
    Promise.all([
      fetch(`/api/attendance/test/events?user_id=${userId}&date=${date}`).then(r => r.json()),
      fetch(`/api/attendance/test/summary?user_id=${userId}&date=${date}`).then(r => r.json()),
    ]).then(([evs, summaryResp]) => {
      setEvents(Array.isArray(evs) ? evs : []);
      setSummary(summaryResp.summary ?? null);
      setLoading(false);
    });
  };

  useEffect(fetchAll, [userId, date]);

  const addEvent = async () => {
    if (!userId) { showToast('Select an employee first.', 'error'); return; }
    setAdding(true);
    try {
      const res = await fetch('/api/attendance/test/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: Number(userId), event_date: date, event_type: eventType, time }),
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.error || 'Failed to add simulated event.', 'error'); return; }
      showToast('Simulated event added!');
      fetchAll();
    } finally {
      setAdding(false);
    }
  };

  const clearDay = async () => {
    if (!userId || !confirm('Clear all simulated events for this employee/date?')) return;
    await fetch(`/api/attendance/test/events?user_id=${userId}&date=${date}`, { method: 'DELETE' });
    showToast('Test data cleared for this employee/date.');
    fetchAll();
  };

  const clearAll = async () => {
    if (!confirm('Clear ALL simulated test data across every employee and date? This cannot be undone.')) return;
    await fetch('/api/attendance/test/events?all=1', { method: 'DELETE' });
    showToast('All test data cleared.');
    fetchAll();
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 flex items-start gap-3">
        <FlaskConical className="text-amber-500 shrink-0 mt-0.5" size={20} />
        <div>
          <p className="text-sm font-semibold text-amber-800">Admin Test / Simulation Mode</p>
          <p className="text-xs text-amber-700 mt-1">
            Records created here are marked as <b>TEST DATA</b> and are always excluded from real attendance
            reports, the Dashboard, and OT/payroll-ready totals — they exist only to preview how the rules
            engine computes a full workday without waiting for real clock time. Simulated actions follow the
            same sequencing rules as a real clock-in (no duplicate Time In, break limits enforced, etc.).
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="form-label">Employee</label>
          <select className="form-input py-1.5 text-sm w-auto" value={userId} onChange={e => setUserId(e.target.value)}>
            <option value="">Select employee...</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
        <div>
          <label className="form-label">Date</label>
          <input type="date" className="form-input py-1.5 text-sm w-auto" value={date} onChange={e => setDate(e.target.value)} />
        </div>
        {userId && (
          <button onClick={clearDay} className="btn-secondary text-xs py-1.5">
            <Trash2 size={13} /> Clear This Day
          </button>
        )}
        <button onClick={clearAll} className="text-xs text-red-500 hover:text-red-700 font-medium ml-auto">
          Clear All Test Data
        </button>
      </div>

      {!userId ? (
        <p className="text-sm text-gray-400 text-center py-12">Select an employee and date to start simulating.</p>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="card space-y-3">
            <p className="text-sm font-semibold text-gray-700">Add Simulated Event</p>
            <div>
              <label className="form-label">Action</label>
              <select className="form-input" value={eventType} onChange={e => setEventType(e.target.value as EventType)}>
                {Object.entries(EVENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Time (PH-local)</label>
              <input type="time" className="form-input" value={time} onChange={e => setTime(e.target.value)} />
            </div>
            <button onClick={addEvent} disabled={adding} className="btn-primary w-full justify-center disabled:opacity-50">
              {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              {adding ? 'Adding...' : 'Add Simulated Event'}
            </button>

            {events.length > 0 && (
              <div className="border-t border-gray-100 pt-3 space-y-1.5">
                <p className="text-xs font-semibold text-gray-500 flex items-center gap-1.5">
                  Simulated Timeline <span className="badge-amber">TEST DATA</span>
                </p>
                {events.filter((e: any) => !e.superseded_by).map((e: any) => (
                  <div key={e.id} className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">{EVENT_LABELS[e.event_type as EventType]}</span>
                    <span className="font-medium text-gray-800">
                      {new Date(e.event_time).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card space-y-2.5">
            <p className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
              Computed Preview <span className="badge-amber">TEST DATA</span>
            </p>
            {loading ? (
              <div className="flex justify-center py-8"><Loader2 className="animate-spin text-gray-300" size={20} /></div>
            ) : summary ? (
              <>
                <span className={STATUS_BADGE[summary.status as AttendanceStatus]}>{STATUS_LABEL[summary.status as AttendanceStatus]}</span>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm pt-2">
                  <div className="flex justify-between"><span className="text-gray-500">Worked Hours</span><span className="font-medium text-gray-800">{fmtMinutes(summary.totalWorkMinutes)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Break Time</span><span className="font-medium text-gray-800">{fmtMinutes(summary.breakMinutes)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Late</span><span className="font-medium text-gray-800">{summary.lateMinutes > 0 ? fmtMinutes(summary.lateMinutes) : '—'}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Undertime</span><span className="font-medium text-gray-800">{summary.undertimeMinutes > 0 ? fmtMinutes(summary.undertimeMinutes) : '—'}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Excess Break</span><span className="font-medium text-gray-800">{summary.excessBreakMinutes > 0 ? fmtMinutes(summary.excessBreakMinutes) : '—'}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Potential OT</span><span className="font-medium text-gray-800">{summary.potentialOtMinutes > 0 ? fmtMinutes(summary.potentialOtMinutes) : '—'}</span></div>
                </div>
              </>
            ) : (
              <p className="text-sm text-gray-400 py-4">No simulated events yet for this employee/date.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
