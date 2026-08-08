'use client';

import { useEffect, useState } from 'react';
import { Loader2, FlaskConical, Trash2, Plus, Pencil } from 'lucide-react';
import { formatDate, todayISO } from '@/lib/utils';
import { Toast, useToast } from '@/components/ui/Toast';
import Modal from '@/components/ui/Modal';
import type { EventType, AttendanceStatus } from '@/lib/attendance';

// Simple HR Mode: Attendance now only covers day-to-day operations —
// Shift Templates, Attendance Rules, and Test Mode moved to HR Settings
// (see components/hr/HrSettingsClient.tsx, which imports SettingsTab/
// ShiftsTab/TestModeTab straight from this file — nothing about those
// tabs' logic changed, only where they're reachable from). The old
// Dashboard tab moved to its own HR Dashboard page for the same reason.
type Tab = 'today' | 'records' | 'ot' | 'corrections';

const TABS: { key: Tab; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'records', label: 'Daily Records' },
  { key: 'ot', label: 'OT for Approval' },
  { key: 'corrections', label: 'Attendance Corrections' },
];

type ExtendedStatus = AttendanceStatus | 'rest_day' | 'on_leave' | 'holiday' | 'official_business';

const STATUS_BADGE: Record<ExtendedStatus, string> = {
  not_started: 'badge-gray',
  present: 'badge-green',
  late: 'badge-amber',
  absent: 'badge-red',
  half_day: 'badge-amber',
  undertime: 'badge-amber',
  rest_day: 'badge-gray',
  on_leave: 'badge-blue',
  holiday: 'badge-blue',
  official_business: 'badge-blue',
};

const STATUS_LABEL: Record<ExtendedStatus, string> = {
  not_started: 'Not Clocked In',
  present: 'Present',
  late: 'Late',
  absent: 'Absent',
  half_day: 'Half Day',
  undertime: 'Undertime',
  rest_day: 'Rest Day',
  on_leave: 'On Leave',
  holiday: 'Holiday',
  official_business: 'Official Business',
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
  const [tab, setTab] = useState<Tab>('today');

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}

      <div>
        <h1 className="text-2xl font-bold text-gray-900">Attendance</h1>
        <p className="text-sm text-gray-500 mt-1">Today's status, daily records, and approvals</p>
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

      {tab === 'today' && <TodayTab />}
      {tab === 'records' && <RecordsTab />}
      {tab === 'ot' && <OtTab showToast={showToast} />}
      {tab === 'corrections' && <CorrectionsTab showToast={showToast} />}
    </div>
  );
}

// ── Today (the new simple default view) ─────────────────────────────────

function TodayTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchToday = () => {
    const today = todayISO();
    fetch(`/api/attendance/records?from=${today}&to=${today}`).then(r => r.json()).then(d => {
      setRows(Array.isArray(d) ? d : []);
      setLastUpdated(new Date());
      setLoading(false);
    });
  };

  useEffect(() => {
    fetchToday();
    const id = setInterval(fetchToday, 45_000);
    return () => clearInterval(id);
  }, []);

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-300" size={24} /></div>;

  return (
    <div className="space-y-3">
      {lastUpdated && (
        <p className="text-xs text-gray-400 text-right">
          Updated {lastUpdated.toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' })} · auto-refreshes every 45s
        </p>
      )}
      <div className="card p-0 overflow-hidden">
        {rows.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-12">No employees to show today.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="table-header">Employee</th>
                  <th className="table-header">Status</th>
                  <th className="table-header">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((r, i) => (
                  <tr key={i} className="hover:bg-gray-50/60">
                    <td className="table-cell font-medium text-gray-900">{r.name}</td>
                    <td className="table-cell">
                      <span className={STATUS_BADGE[r.status as ExtendedStatus]}>{STATUS_LABEL[r.status as ExtendedStatus]}</span>
                    </td>
                    <td className="table-cell text-gray-500 text-xs">
                      {r.exceptionLabel || (r.lateMinutes > 0 ? `Late ${fmtMinutes(r.lateMinutes)}` : '')}
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

// ── Settings ─────────────────────────────────────────────────────────────

interface Settings {
  lunch_break_minutes: number; coffee_break_minutes: number; coffee_breaks_allowed: number;
  lunch_break_paid: boolean; coffee_break_paid: boolean;
  min_minutes_before_ot: number; selfie_required: boolean; work_days: number[];
}

export function SettingsTab({ showToast }: { showToast: (m: string, t?: 'success' | 'error') => void }) {
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
      <div className="rounded-lg bg-blue-50 border border-blue-100 px-4 py-2.5 text-xs text-blue-700">
        Work start/end time and grace period are now set per Shift Template — see the <b>Shifts</b> tab.
      </div>

      <div>
        <label className="form-label">Min. Minutes Before OT Eligible</label>
        <p className="text-xs text-gray-400 mb-1">Applies after each employee's own assigned shift end time.</p>
        <input type="number" className="form-input max-w-xs" value={settings.min_minutes_before_ot} onChange={e => setSettings({ ...settings, min_minutes_before_ot: Number(e.target.value) })} />
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
    if (userId) params.set('employee_id', userId);
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
                  <th className="table-header">Shift</th>
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
                    <td className="table-cell text-gray-500 text-xs">{r.shift_name || '—'}</td>
                    <td className="table-cell">
                      <span className={STATUS_BADGE[r.status as ExtendedStatus]}>{STATUS_LABEL[r.status as ExtendedStatus]}</span>
                      {r.exceptionLabel && <span className="text-xs text-gray-400 ml-1.5">{r.exceptionLabel}</span>}
                    </td>
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

export function OtReviewModal({ request, onClose, onDone }: { request: any; onClose: () => void; onDone: () => void }) {
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

export function CorrectionReviewModal({ request, onClose, onDone }: { request: any; onClose: () => void; onDone: () => void }) {
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

export function TestModeTab({ showToast }: { showToast: (m: string, t?: 'success' | 'error') => void }) {
  const [employees, setEmployees] = useState<{ id: number; name: string }[]>([]);
  const [shifts, setShifts] = useState<ShiftTemplate[]>([]);
  const [userId, setUserId] = useState('');
  const [shiftId, setShiftId] = useState(''); // '' = use the employee's real assigned shift
  const [date, setDate] = useState(todayISO());
  const [events, setEvents] = useState<any[]>([]);
  const [summary, setSummary] = useState<any | null>(null);
  const [resolvedShift, setResolvedShift] = useState<ShiftTemplate | null>(null);
  const [loading, setLoading] = useState(false);
  const [eventType, setEventType] = useState<EventType>('TIME_IN');
  const [time, setTime] = useState('09:00');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    fetch('/api/attendance/employees').then(r => r.json()).then(d => setEmployees(Array.isArray(d) ? d : []));
    fetch('/api/attendance/shifts').then(r => r.json()).then(d => setShifts(Array.isArray(d) ? d : []));
  }, []);

  const fetchAll = () => {
    if (!userId || !date) { setEvents([]); setSummary(null); setResolvedShift(null); return; }
    setLoading(true);
    const shiftParam = shiftId ? `&shift_id=${shiftId}` : '';
    Promise.all([
      fetch(`/api/attendance/test/events?employee_id=${userId}&date=${date}`).then(r => r.json()),
      fetch(`/api/attendance/test/summary?employee_id=${userId}&date=${date}${shiftParam}`).then(r => r.json()),
    ]).then(([evs, summaryResp]) => {
      setEvents(Array.isArray(evs) ? evs : []);
      setSummary(summaryResp.summary ?? null);
      setResolvedShift(summaryResp.shift ?? null);
      setLoading(false);
    });
  };

  useEffect(fetchAll, [userId, date, shiftId]);

  const addEvent = async () => {
    if (!userId) { showToast('Select an employee first.', 'error'); return; }
    setAdding(true);
    try {
      const res = await fetch('/api/attendance/test/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: Number(userId), event_date: date, event_type: eventType, time, shift_id: shiftId ? Number(shiftId) : undefined }),
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
    await fetch(`/api/attendance/test/events?employee_id=${userId}&date=${date}`, { method: 'DELETE' });
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
        <div>
          <label className="form-label">Simulate With Shift</label>
          <select className="form-input py-1.5 text-sm w-auto" value={shiftId} onChange={e => setShiftId(e.target.value)}>
            <option value="">Employee's assigned shift</option>
            {shifts.map(s => <option key={s.id} value={s.id}>{s.name} ({fmtShiftTime(s.start_time)}–{fmtShiftTime(s.end_time)})</option>)}
          </select>
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
            {resolvedShift && (
              <p className="text-xs text-gray-400">
                Using {resolvedShift.name} ({fmtShiftTime(resolvedShift.start_time)}–{fmtShiftTime(resolvedShift.end_time)}, {resolvedShift.grace_period_minutes}m grace)
              </p>
            )}
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

// ── Shift Templates + Assignments ───────────────────────────────────────

interface ShiftTemplate {
  id: number;
  name: string;
  start_time: string;
  end_time: string;
  grace_period_minutes: number;
  active: number;
}

function fmtShiftTime(t: string) {
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

export function ShiftsTab({ showToast }: { showToast: (m: string, t?: 'success' | 'error') => void }) {
  const [shifts, setShifts] = useState<ShiftTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingShift, setEditingShift] = useState<ShiftTemplate | 'new' | null>(null);

  const fetchAll = () => {
    setLoading(true);
    fetch('/api/attendance/shifts').then(r => r.json()).then(s => {
      setShifts(Array.isArray(s) ? s : []);
      setLoading(false);
    });
  };

  useEffect(fetchAll, []);

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-300" size={24} /></div>;

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-blue-50 border border-blue-100 px-4 py-2.5 text-xs text-blue-700">
        Assigning an employee to a shift now happens on their profile — see <b>Employees</b> in the sidebar.
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-semibold text-gray-700">Shift Templates</p>
          <button onClick={() => setEditingShift('new')} className="btn-secondary text-xs py-1.5">
            <Plus size={13} /> Add Shift Template
          </button>
        </div>
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="table-header">Name</th>
                <th className="table-header">Start</th>
                <th className="table-header">End</th>
                <th className="table-header">Grace Period</th>
                <th className="table-header">Status</th>
                <th className="table-header"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {shifts.map(s => (
                <tr key={s.id} className="hover:bg-gray-50/60">
                  <td className="table-cell font-medium text-gray-900">{s.name}</td>
                  <td className="table-cell">{fmtShiftTime(s.start_time)}</td>
                  <td className="table-cell">{fmtShiftTime(s.end_time)}</td>
                  <td className="table-cell">{s.grace_period_minutes}m</td>
                  <td className="table-cell">
                    <span className={s.active ? 'badge-green' : 'badge-gray'}>{s.active ? 'Active' : 'Inactive'}</span>
                  </td>
                  <td className="table-cell text-right">
                    <button onClick={() => setEditingShift(s)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700">
                      <Pencil size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editingShift && (
        <Modal open={!!editingShift} onClose={() => setEditingShift(null)} title={editingShift === 'new' ? 'Add Shift Template' : 'Edit Shift Template'} size="sm">
          <ShiftTemplateForm
            shift={editingShift === 'new' ? null : editingShift}
            onCancel={() => setEditingShift(null)}
            onSaved={() => { setEditingShift(null); showToast('Shift template saved!'); fetchAll(); }}
          />
        </Modal>
      )}
    </div>
  );
}

function ShiftTemplateForm({ shift, onCancel, onSaved }: { shift: ShiftTemplate | null; onCancel: () => void; onSaved: () => void }) {
  const [name, setName] = useState(shift?.name ?? '');
  const [startTime, setStartTime] = useState(shift?.start_time ?? '09:00');
  const [endTime, setEndTime] = useState(shift?.end_time ?? '18:00');
  const [gracePeriod, setGracePeriod] = useState(shift?.grace_period_minutes ?? 15);
  const [active, setActive] = useState(shift ? !!shift.active : true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!name.trim()) { setError('Name is required.'); return; }
    setSaving(true);
    setError('');
    try {
      const url = shift ? `/api/attendance/shifts/${shift.id}` : '/api/attendance/shifts';
      const method = shift ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), start_time: startTime, end_time: endTime, grace_period_minutes: gracePeriod, active }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to save.'); return; }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="form-label">Shift Name</label>
        <input type="text" className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Shift A" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="form-label">Start Time</label>
          <input type="time" className="form-input" value={startTime} onChange={e => setStartTime(e.target.value)} />
        </div>
        <div>
          <label className="form-label">End Time</label>
          <input type="time" className="form-input" value={endTime} onChange={e => setEndTime(e.target.value)} />
        </div>
      </div>
      <div>
        <label className="form-label">Grace Period (minutes)</label>
        <input type="number" className="form-input" value={gracePeriod} onChange={e => setGracePeriod(Number(e.target.value))} />
      </div>
      {shift && (
        <div>
          <label className="form-label">Status</label>
          <select className="form-input" value={active ? '1' : '0'} onChange={e => setActive(e.target.value === '1')}>
            <option value="1">Active</option>
            <option value="0">Inactive</option>
          </select>
        </div>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="btn-secondary">Cancel</button>
        <button onClick={save} disabled={saving} className="btn-primary disabled:opacity-50">
          {saving ? <Loader2 size={14} className="animate-spin" /> : null}
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
}

