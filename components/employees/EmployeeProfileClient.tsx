'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ArrowLeft, FileText, Briefcase, Wallet, ShieldAlert } from 'lucide-react';
import { formatDate, formatCurrency, todayISO } from '@/lib/utils';
import { Toast, useToast } from '@/components/ui/Toast';
import Modal from '@/components/ui/Modal';
import { EntryDetailModal, STATUS_LABEL, STATUS_BADGE } from '@/components/payroll/PayrollClient';

type Tab = 'overview' | 'attendance' | 'documents' | 'history' | 'payroll' | 'payslips' | 'loans' | 'leave' | 'disciplinary';

// Only Overview and Attendance actually show per-employee data on THIS
// screen. Payroll/Payslips/Leave are real, live features elsewhere in the
// system (Payroll, Payslips, and Leave Management/HR Dashboard) — this tab
// just points there instead of duplicating them. Documents/Employment
// History/Loans/Disciplinary are the only genuinely not-yet-built ones, so
// only those render smaller and muted — keeping all 9 tabs equal weight
// made this screen look like 9 working sections instead of 2, which is
// confusing for a first-time HR user.
const TABS: { key: Tab; label: string; soon?: boolean }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'payroll', label: 'Payroll' },
  { key: 'payslips', label: 'Payslips' },
  { key: 'leave', label: 'Leave' },
  { key: 'documents', label: 'Documents', soon: true },
  { key: 'history', label: 'Employment History', soon: true },
  { key: 'loans', label: 'Loans / Cash Advances', soon: true },
  { key: 'disciplinary', label: 'Disciplinary', soon: true },
];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface EmployeeDetail {
  id: number;
  employee_code: string;
  full_name: string;
  mobile_number: string | null;
  email: string | null;
  address: string | null;
  birthday: string | null;
  emergency_contact_name: string | null;
  emergency_contact_number: string | null;
  position: string | null;
  department: string | null;
  branch: string | null;
  date_hired: string | null;
  employment_type: 'Regular' | 'Probationary' | 'Contractual';
  employment_status: 'Active' | 'Inactive' | 'Resigned' | 'Terminated';
  work_days: string;
  rest_day: number | null;
  attendance_enabled: number;
  linked_user_id: number | null;
  linked_user: { id: number; name: string; username: string } | null;
  current_shift: { id: number; name: string; start_time: string; end_time: string } | null;
  salary_type: 'Monthly' | 'Daily';
  basic_rate: number;
  allowance: number;
  ot_eligible: number;
}

function fmtShiftTime(t: string) {
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

export default function EmployeeProfileClient({ employeeId }: { employeeId: number }) {
  const router = useRouter();
  const { toast, showToast, clearToast } = useToast();
  const [tab, setTab] = useState<Tab>('overview');
  const [employee, setEmployee] = useState<EmployeeDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchEmployee = () => {
    fetch(`/api/employees/${employeeId}`).then(r => r.json()).then(d => { setEmployee(d); setLoading(false); });
  };

  useEffect(fetchEmployee, [employeeId]);

  if (loading || !employee) {
    return <div className="flex justify-center py-24"><Loader2 className="animate-spin text-gray-300" size={24} /></div>;
  }

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}

      <button onClick={() => router.push('/employees')} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 py-2 -my-2">
        <ArrowLeft size={15} /> Back to Employees
      </button>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{employee.full_name}</h1>
          <p className="text-sm text-gray-500 mt-1 font-mono">{employee.employee_code} · {employee.position || 'No position set'}</p>
        </div>
        <span className={
          employee.employment_status === 'Active' ? 'badge-green' :
          employee.employment_status === 'Inactive' ? 'badge-gray' :
          employee.employment_status === 'Resigned' ? 'badge-amber' : 'badge-red'
        }>
          {employee.employment_status}
        </span>
      </div>

      <div className="flex gap-1 flex-wrap items-center">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-lg font-semibold transition-colors ${t.soon ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm'} ${
              tab === t.key ? 'bg-orange-500 text-white' : t.soon ? 'bg-gray-50 text-gray-400 hover:bg-gray-100' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab employee={employee} onSaved={() => { showToast('Employee updated!'); fetchEmployee(); }} showToast={showToast} />}
      {tab === 'attendance' && <AttendanceTab employeeId={employee.id} />}
      {tab === 'payroll' && <PayrollHistoryTab employeeId={employee.id} />}
      {tab === 'payslips' && <PayslipHistoryTab employeeId={employee.id} />}
      {tab === 'leave' && <LeaveHistoryTab employeeId={employee.id} />}
      {tab === 'documents' && <ComingSoon icon={FileText} label="Documents" description="Upload and manage 201-file documents (IDs, contracts, certificates) here in a future update." />}
      {tab === 'history' && <ComingSoon icon={Briefcase} label="Employment History" description="Track promotions, transfers, and role changes here in a future update." />}
      {tab === 'loans' && <ComingSoon icon={Wallet} label="Loans / Cash Advances" description="Loan and cash advance requests, balances, and deduction schedules will live here in a future update." />}
      {tab === 'disciplinary' && <ComingSoon icon={ShieldAlert} label="Disciplinary" description="Disciplinary records and case history will live here in a future update." />}
    </div>
  );
}

function ComingSoon({ icon: Icon, label, description }: { icon: typeof FileText; label: string; description: string }) {
  return (
    <div className="card text-center py-16">
      <Icon className="mx-auto text-gray-300 mb-3" size={32} />
      <p className="text-sm font-semibold text-gray-500">{label} — Coming Soon</p>
      <p className="text-xs text-gray-400 mt-1 max-w-sm mx-auto">{description}</p>
    </div>
  );
}

// ── Overview ─────────────────────────────────────────────────────────────

function OverviewTab({ employee, onSaved, showToast }: { employee: EmployeeDetail; onSaved: () => void; showToast: (m: string, t?: 'success' | 'error') => void }) {
  const [form, setForm] = useState({
    full_name: employee.full_name,
    mobile_number: employee.mobile_number ?? '',
    email: employee.email ?? '',
    address: employee.address ?? '',
    birthday: employee.birthday ?? '',
    emergency_contact_name: employee.emergency_contact_name ?? '',
    emergency_contact_number: employee.emergency_contact_number ?? '',
    position: employee.position ?? '',
    department: employee.department ?? '',
    branch: employee.branch ?? '',
    date_hired: employee.date_hired ?? '',
    employment_type: employee.employment_type,
    employment_status: employee.employment_status,
    work_days: employee.work_days.split(',').filter(Boolean).map(Number),
    rest_day: employee.rest_day,
    attendance_enabled: !!employee.attendance_enabled,
    linked_user_id: employee.linked_user_id,
    salary_type: employee.salary_type,
    basic_rate: employee.basic_rate,
    allowance: employee.allowance,
    ot_eligible: !!employee.ot_eligible,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [users, setUsers] = useState<{ id: number; name: string; username: string; linked_employee_id: number | null }[]>([]);
  const [showReassign, setShowReassign] = useState(false);

  useEffect(() => {
    fetch('/api/employees/available-users').then(r => r.json()).then(d => setUsers(Array.isArray(d) ? d : []));
  }, []);

  const set = (patch: Partial<typeof form>) => setForm(f => ({ ...f, ...patch }));

  const toggleWorkDay = (dow: number) => {
    set({ work_days: form.work_days.includes(dow) ? form.work_days.filter(d => d !== dow) : [...form.work_days, dow].sort() });
  };

  const save = async () => {
    if (!form.full_name.trim()) { setError('Full name is required.'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/employees/${employee.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to save.'); return; }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const quickToggleStatus = async () => {
    const nextStatus = form.employment_status === 'Active' ? 'Inactive' : 'Active';
    set({ employment_status: nextStatus });
    setSaving(true);
    try {
      const res = await fetch(`/api/employees/${employee.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, employment_status: nextStatus }),
      });
      if (res.ok) { showToast(`Employee ${nextStatus === 'Active' ? 'activated' : 'deactivated'}!`); onSaved(); }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid md:grid-cols-2 gap-5">
        {/* Basic Information */}
        <div className="card space-y-3">
          <p className="text-sm font-semibold text-gray-700">Basic Information</p>
          <div>
            <label className="form-label">Employee ID</label>
            <input type="text" className="form-input font-mono bg-gray-50" value={employee.employee_code} disabled />
          </div>
          <div>
            <label className="form-label">Full Name</label>
            <input type="text" className="form-input" value={form.full_name} onChange={e => set({ full_name: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Mobile Number</label>
              <input type="text" className="form-input" value={form.mobile_number} onChange={e => set({ mobile_number: e.target.value })} />
            </div>
            <div>
              <label className="form-label">Email</label>
              <input type="email" className="form-input" value={form.email} onChange={e => set({ email: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="form-label">Address</label>
            <input type="text" className="form-input" value={form.address} onChange={e => set({ address: e.target.value })} />
          </div>
          <div>
            <label className="form-label">Birthday</label>
            <input type="date" className="form-input" value={form.birthday} onChange={e => set({ birthday: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Emergency Contact Name</label>
              <input type="text" className="form-input" value={form.emergency_contact_name} onChange={e => set({ emergency_contact_name: e.target.value })} />
            </div>
            <div>
              <label className="form-label">Emergency Contact Number</label>
              <input type="text" className="form-input" value={form.emergency_contact_number} onChange={e => set({ emergency_contact_number: e.target.value })} />
            </div>
          </div>
        </div>

        {/* Employment */}
        <div className="card space-y-3">
          <p className="text-sm font-semibold text-gray-700">Employment</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Position</label>
              <input type="text" className="form-input" value={form.position} onChange={e => set({ position: e.target.value })} />
            </div>
            <div>
              <label className="form-label">Department</label>
              <input type="text" className="form-input" value={form.department} onChange={e => set({ department: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Branch</label>
              <input type="text" className="form-input" value={form.branch} onChange={e => set({ branch: e.target.value })} />
            </div>
            <div>
              <label className="form-label">Date Hired</label>
              <input type="date" className="form-input" value={form.date_hired} onChange={e => set({ date_hired: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Employment Type</label>
              <select className="form-input" value={form.employment_type} onChange={e => set({ employment_type: e.target.value as any })}>
                <option value="Regular">Regular</option>
                <option value="Probationary">Probationary</option>
                <option value="Contractual">Contractual</option>
              </select>
            </div>
            <div>
              <label className="form-label">Employment Status</label>
              <select className="form-input" value={form.employment_status} onChange={e => set({ employment_status: e.target.value as any })}>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
                <option value="Resigned">Resigned</option>
                <option value="Terminated">Terminated</option>
              </select>
            </div>
          </div>
          <button onClick={quickToggleStatus} disabled={saving} className="btn-secondary text-xs py-1.5 disabled:opacity-50">
            {form.employment_status === 'Active' ? 'Quick Deactivate' : 'Quick Activate'}
          </button>

          <div className="border-t border-gray-100 pt-3">
            <label className="form-label">Linked System User (optional)</label>
            <select className="form-input" value={form.linked_user_id ?? ''} onChange={e => set({ linked_user_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">Not linked (no system login)</option>
              {users.filter(u => !u.linked_employee_id || u.linked_employee_id === employee.id).map(u => (
                <option key={u.id} value={u.id}>{u.name} ({u.username})</option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-1">Only needed if this employee logs in to clock their own attendance.</p>
          </div>
        </div>

        {/* Attendance */}
        <div className="card space-y-3">
          <p className="text-sm font-semibold text-gray-700">Attendance</p>
          <div>
            <label className="form-label">Default Shift</label>
            {employee.current_shift ? (
              <div className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                <span className="text-sm text-gray-700">
                  {employee.current_shift.name} ({fmtShiftTime(employee.current_shift.start_time)}–{fmtShiftTime(employee.current_shift.end_time)})
                </span>
                <button onClick={() => setShowReassign(true)} className="btn-secondary text-xs py-1">Change Default Shift</button>
              </div>
            ) : (
              <div className="flex items-center justify-between bg-red-50 rounded-lg px-3 py-2">
                <span className="text-sm text-red-600">No default shift assigned</span>
                <button onClick={() => setShowReassign(true)} className="btn-secondary text-xs py-1">Assign Shift</button>
              </div>
            )}
            <p className="text-xs text-gray-400 mt-1">
              Assigned once — used automatically for all future attendance calculations. For a one-day temporary change, use the Attendance tab's Date-Specific Override instead.
            </p>
          </div>
          <div>
            <label className="form-label">Work Days</label>
            <div className="flex gap-1.5 flex-wrap">
              {WEEKDAYS.map((d, i) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleWorkDay(i)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    form.work_days.includes(i) ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="form-label">Rest Day</label>
            <select className="form-input" value={form.rest_day ?? ''} onChange={e => set({ rest_day: e.target.value === '' ? null : Number(e.target.value) })}>
              <option value="">Not set</option>
              {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={form.attendance_enabled} onChange={e => set({ attendance_enabled: e.target.checked })} />
            Attendance Enabled
          </label>
          <p className="text-xs text-gray-400">
            Only Active employees with Attendance Enabled appear in Attendance and HR Dashboard reports.
          </p>
        </div>

        {/* Compensation */}
        <div className="card space-y-3">
          <p className="text-sm font-semibold text-gray-700">Compensation <span className="text-xs font-normal text-gray-400">(used by Payroll)</span></p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Salary Type</label>
              <select className="form-input" value={form.salary_type} onChange={e => set({ salary_type: e.target.value as any })}>
                <option value="Monthly">Monthly</option>
                <option value="Daily">Daily</option>
              </select>
            </div>
            <div>
              <label className="form-label">{form.salary_type === 'Monthly' ? 'Basic Salary' : 'Daily Rate'} (₱)</label>
              <input type="number" className="form-input" value={form.basic_rate} onChange={e => set({ basic_rate: Number(e.target.value) })} />
            </div>
          </div>
          <div>
            <label className="form-label">Allowance (₱)</label>
            <input type="number" className="form-input" value={form.allowance} onChange={e => set({ allowance: Number(e.target.value) })} />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={form.ot_eligible} onChange={e => set({ ot_eligible: e.target.checked })} />
            OT Eligible
          </label>
        </div>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex justify-end">
        <button onClick={save} disabled={saving} className="btn-primary disabled:opacity-50">
          {saving ? <Loader2 size={14} className="animate-spin" /> : null}
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      {showReassign && (
        <Modal open={showReassign} onClose={() => setShowReassign(false)} title="Change Default Shift" size="sm">
          <ReassignShiftForm employeeId={employee.id} onCancel={() => setShowReassign(false)} onSaved={() => { setShowReassign(false); showToast('Default shift updated!'); onSaved(); }} />
        </Modal>
      )}
    </div>
  );
}

function ReassignShiftForm({ employeeId, onCancel, onSaved }: { employeeId: number; onCancel: () => void; onSaved: () => void }) {
  const [shifts, setShifts] = useState<{ id: number; name: string; start_time: string; end_time: string; active: number }[]>([]);
  const [shiftId, setShiftId] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(todayISO());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/attendance/shifts').then(r => r.json()).then(d => {
      const list = Array.isArray(d) ? d.filter((s: any) => s.active) : [];
      setShifts(list);
      if (list.length) setShiftId(String(list[0].id));
    });
  }, []);

  const save = async () => {
    if (!shiftId) { setError('Select a shift.'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/attendance/shift-assignments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: employeeId, shift_id: Number(shiftId), effective_from: effectiveFrom }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to assign.'); return; }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="form-label">Shift</label>
        <select className="form-input" value={shiftId} onChange={e => setShiftId(e.target.value)}>
          {shifts.map(s => <option key={s.id} value={s.id}>{s.name} ({fmtShiftTime(s.start_time)}–{fmtShiftTime(s.end_time)})</option>)}
        </select>
      </div>
      <div>
        <label className="form-label">Effective From</label>
        <input type="date" className="form-input" value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} />
        <p className="text-xs text-gray-400 mt-1">Attendance before this date keeps using the previous shift — past records are never recalculated.</p>
      </div>
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

// ── Attendance ───────────────────────────────────────────────────────────

function AttendanceTab({ employeeId }: { employeeId: number }) {
  const [from, setFrom] = useState(() => {
    const d = new Date(Date.now() + 8 * 3600 * 1000 - 13 * 86_400_000);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(todayISO());
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/attendance/records?from=${from}&to=${to}&employee_id=${employeeId}`).then(r => r.json()).then(d => {
      setRows(Array.isArray(d) ? d : []);
      setLoading(false);
    });
  }, [from, to, employeeId]);

  const fmtMinutes = (m: number) => { const h = Math.floor(m / 60), mm = m % 60; return h > 0 ? `${h}h ${mm}m` : `${mm}m`; };

  return (
    <div className="space-y-6">
      <ShiftOverridesSection employeeId={employeeId} />

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="form-label">From</label>
          <input type="date" className="form-input py-1.5 text-sm w-auto" value={from} onChange={e => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="form-label">To</label>
          <input type="date" className="form-input py-1.5 text-sm w-auto" value={to} onChange={e => setTo(e.target.value)} />
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-300" size={24} /></div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-12">No attendance records for this range.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="table-header">Date</th>
                  <th className="table-header">Status</th>
                  <th className="table-header">Work Hours</th>
                  <th className="table-header">Late</th>
                  <th className="table-header">Undertime</th>
                  <th className="table-header">Potential OT</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((r, i) => (
                  <tr key={i} className="hover:bg-gray-50/60">
                    <td className="table-cell">{formatDate(r.date)}</td>
                    <td className="table-cell capitalize">{r.status.replace('_', ' ')}</td>
                    <td className="table-cell">{fmtMinutes(r.totalWorkMinutes)}</td>
                    <td className="table-cell">{r.lateMinutes > 0 ? fmtMinutes(r.lateMinutes) : '—'}</td>
                    <td className="table-cell">{r.undertimeMinutes > 0 ? fmtMinutes(r.undertimeMinutes) : '—'}</td>
                    <td className="table-cell">{r.potentialOtMinutes > 0 ? fmtMinutes(r.potentialOtMinutes) : '—'}</td>
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

// ── Leave History ────────────────────────────────────────────────────────

function LeaveHistoryTab({ employeeId }: { employeeId: number }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/leave-requests?employee_id=${employeeId}`).then(r => r.ok ? r.json() : []).then(d => {
      setRows(Array.isArray(d) ? d : []);
      setLoading(false);
    });
  }, [employeeId]);

  return (
    <div className="card p-0 overflow-hidden">
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-300" size={24} /></div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-12">No leave requests yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="table-header">Date</th>
                <th className="table-header">Leave Type</th>
                <th className="table-header">Day</th>
                <th className="table-header">Paid</th>
                <th className="table-header">Status</th>
                <th className="table-header">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map((r: any) => (
                <tr key={r.id} className="hover:bg-gray-50/60">
                  <td className="table-cell whitespace-nowrap">{formatDate(r.from_date)}{r.from_date !== r.to_date ? ` – ${formatDate(r.to_date)}` : ''}</td>
                  <td className="table-cell">{r.leave_type_name}</td>
                  <td className="table-cell capitalize">{r.day_type}</td>
                  <td className="table-cell">{r.leave_type_paid ? <span className="badge-green">Paid</span> : <span className="badge-gray">Unpaid</span>}</td>
                  <td className="table-cell">
                    <span className={r.status === 'approved' ? 'badge-green' : r.status === 'rejected' ? 'badge-red' : 'badge-amber'}>{r.status}</span>
                  </td>
                  <td className="table-cell text-gray-500 max-w-xs truncate" title={r.reason}>{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Payroll History ──────────────────────────────────────────────────────

function PayrollHistoryTab({ employeeId }: { employeeId: number }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [detailEntryId, setDetailEntryId] = useState<number | null>(null);

  const fetchRows = () => {
    setLoading(true);
    fetch(`/api/payroll/entries?employee_id=${employeeId}`).then(r => {
      if (r.status === 403) { setForbidden(true); setLoading(false); return null; }
      return r.json();
    }).then(d => {
      if (d) setRows(Array.isArray(d) ? d : []);
      setLoading(false);
    });
  };

  useEffect(fetchRows, [employeeId]);

  if (forbidden) {
    return <div className="card text-center py-16"><p className="text-sm text-gray-400">You don't have permission to view payroll records.</p></div>;
  }

  return (
    <>
      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-300" size={24} /></div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-12">No payroll history yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="table-header">Payroll Period</th>
                  <th className="table-header">Basic Pay</th>
                  <th className="table-header">OT</th>
                  <th className="table-header">Allowances / Other</th>
                  <th className="table-header">Deductions</th>
                  <th className="table-header">Gross Pay</th>
                  <th className="table-header">Net Pay</th>
                  <th className="table-header">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((r: any) => (
                  <tr key={r.id} onClick={() => setDetailEntryId(r.id)} className="hover:bg-gray-50/60 cursor-pointer">
                    <td className="table-cell font-medium text-gray-900 whitespace-nowrap">{r.period_label}</td>
                    <td className="table-cell">{formatCurrency(r.basic_pay)}</td>
                    <td className="table-cell">{formatCurrency(r.ot_pay)}</td>
                    <td className="table-cell">{formatCurrency(r.allowance_pay + r.bonus_earnings)}</td>
                    <td className="table-cell text-red-500">-{formatCurrency(r.total_deductions)}</td>
                    <td className="table-cell">{formatCurrency(r.gross_pay)}</td>
                    <td className="table-cell font-semibold">{formatCurrency(r.net_pay)}</td>
                    <td className="table-cell"><span className={STATUS_BADGE[r.period_status]}>{STATUS_LABEL[r.period_status]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-gray-400 px-4 py-2 border-t border-gray-100">Click a row to see the full breakdown.</p>
      </div>

      {detailEntryId && (
        <EntryDetailModal
          entryId={detailEntryId}
          locked={true}
          onClose={() => setDetailEntryId(null)}
          onChanged={() => {}}
          showToast={() => {}}
        />
      )}
    </>
  );
}

// ── Payslip History ──────────────────────────────────────────────────────

function PayslipHistoryTab({ employeeId }: { employeeId: number }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/payslips?employee_id=${employeeId}`).then(r => {
      if (r.status === 403) { setForbidden(true); setLoading(false); return null; }
      return r.json();
    }).then(d => {
      if (d) setRows(Array.isArray(d) ? d : []);
      setLoading(false);
    });
  }, [employeeId]);

  if (forbidden) {
    return <div className="card text-center py-16"><p className="text-sm text-gray-400">You don't have permission to view payslips.</p></div>;
  }

  return (
    <div className="card p-0 overflow-hidden">
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-300" size={24} /></div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-12">No payslips generated yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="table-header">Payroll Period</th>
                <th className="table-header">Net Pay</th>
                <th className="table-header">Status</th>
                <th className="table-header"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map((r: any) => (
                <tr key={r.id} className="hover:bg-gray-50/60">
                  <td className="table-cell font-medium text-gray-900 whitespace-nowrap">{r.period_label}</td>
                  <td className="table-cell font-semibold">{formatCurrency(r.net_pay)}</td>
                  <td className="table-cell"><span className={STATUS_BADGE[r.period_status]}>{STATUS_LABEL[r.period_status]}</span></td>
                  <td className="table-cell text-right">
                    <a href={`/payslips/${r.id}`} className="text-orange-600 hover:text-orange-700 text-xs font-medium">View Payslip →</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface ShiftOverride {
  id: number;
  override_date: string;
  reason: string | null;
  shift_id: number;
  shift_name: string;
  start_time: string;
  end_time: string;
}

// Manages one-off date-specific temporary shift overrides — separate from
// the Default Shift above. An override applies to exactly one date and is
// used automatically by every attendance calculation for that date instead
// of the default; it never rewrites the default-shift assignment history.
function ShiftOverridesSection({ employeeId }: { employeeId: number }) {
  const [overrides, setOverrides] = useState<ShiftOverride[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  const fetchOverrides = () => {
    setLoading(true);
    fetch(`/api/attendance/shift-overrides?employee_id=${employeeId}`).then(r => r.json()).then(d => {
      setOverrides(Array.isArray(d) ? d : []);
      setLoading(false);
    });
  };

  useEffect(fetchOverrides, [employeeId]);

  const remove = async (id: number) => {
    await fetch(`/api/attendance/shift-overrides/${id}`, { method: 'DELETE' });
    fetchOverrides();
  };

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-700">Date-Specific Shift Override</p>
          <p className="text-xs text-gray-400 mt-0.5">For a temporary schedule change on a single day only — the default shift resumes automatically afterward.</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-secondary text-xs py-1.5 shrink-0">Add Override</button>
      </div>

      {loading ? (
        <div className="flex justify-center py-4"><Loader2 className="animate-spin text-gray-300" size={18} /></div>
      ) : overrides.length === 0 ? (
        <p className="text-xs text-gray-400">No overrides set.</p>
      ) : (
        <div className="space-y-1.5">
          {overrides.map(o => (
            <div key={o.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 text-sm">
              <span>
                <span className="font-medium text-gray-800">{formatDate(o.override_date)}</span>
                <span className="text-gray-500"> — {o.shift_name} ({fmtShiftTime(o.start_time)}–{fmtShiftTime(o.end_time)})</span>
                {o.reason && <span className="text-gray-400"> · {o.reason}</span>}
              </span>
              <button onClick={() => remove(o.id)} className="text-xs text-red-500 hover:text-red-600 shrink-0 ml-2">Remove</button>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add Date-Specific Override" size="sm">
          <AddOverrideForm employeeId={employeeId} onCancel={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); fetchOverrides(); }} />
        </Modal>
      )}
    </div>
  );
}

function AddOverrideForm({ employeeId, onCancel, onSaved }: { employeeId: number; onCancel: () => void; onSaved: () => void }) {
  const [shifts, setShifts] = useState<{ id: number; name: string; start_time: string; end_time: string; active: number }[]>([]);
  const [date, setDate] = useState(todayISO());
  const [shiftId, setShiftId] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/attendance/shifts').then(r => r.json()).then(d => {
      const list = Array.isArray(d) ? d.filter((s: any) => s.active) : [];
      setShifts(list);
      if (list.length) setShiftId(String(list[0].id));
    });
  }, []);

  const save = async () => {
    if (!date || !shiftId) { setError('Date and shift are required.'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/attendance/shift-overrides', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: employeeId, date, shift_id: Number(shiftId), reason: reason.trim() || null }),
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
        <label className="form-label">Date</label>
        <input type="date" className="form-input" value={date} onChange={e => setDate(e.target.value)} />
      </div>
      <div>
        <label className="form-label">Shift for This Date</label>
        <select className="form-input" value={shiftId} onChange={e => setShiftId(e.target.value)}>
          {shifts.map(s => <option key={s.id} value={s.id}>{s.name} ({fmtShiftTime(s.start_time)}–{fmtShiftTime(s.end_time)})</option>)}
        </select>
      </div>
      <div>
        <label className="form-label">Reason (optional)</label>
        <input type="text" className="form-input" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Covering Shift B for a day" />
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="btn-secondary">Cancel</button>
        <button onClick={save} disabled={saving} className="btn-primary disabled:opacity-50">
          {saving ? <Loader2 size={14} className="animate-spin" /> : null}
          {saving ? 'Saving...' : 'Save Override'}
        </button>
      </div>
    </div>
  );
}
