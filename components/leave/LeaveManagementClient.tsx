'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus, Paperclip } from 'lucide-react';
import { formatDate, todayISO } from '@/lib/utils';
import { Toast, useToast } from '@/components/ui/Toast';
import Modal from '@/components/ui/Modal';

type Tab = 'leave_types' | 'leave_requests' | 'holidays' | 'exceptions';

const TABS: { key: Tab; label: string }[] = [
  { key: 'leave_types', label: 'Leave Types' },
  { key: 'leave_requests', label: 'Leave Requests' },
  { key: 'holidays', label: 'Holiday Calendar' },
  { key: 'exceptions', label: 'Attendance Exceptions' },
];

export default function LeaveManagementClient() {
  const { toast, showToast, clearToast } = useToast();
  const [tab, setTab] = useState<Tab>('leave_requests');

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}

      <div>
        <h1 className="text-2xl font-bold text-gray-900">Leave Management</h1>
        <p className="text-sm text-gray-500 mt-1">Leave types, requests, holiday calendar, and attendance exceptions</p>
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

      {tab === 'leave_types' && <LeaveTypesTab showToast={showToast} />}
      {tab === 'leave_requests' && <LeaveRequestsTab showToast={showToast} />}
      {tab === 'holidays' && <HolidaysTab showToast={showToast} />}
      {tab === 'exceptions' && <ExceptionsTab showToast={showToast} />}
    </div>
  );
}

// ── Leave Types ──────────────────────────────────────────────────────────

interface LeaveType {
  id: number; name: string; paid: number; active: number; annual_credits: number | null;
}

function LeaveTypesTab({ showToast }: { showToast: (m: string, t?: 'success' | 'error') => void }) {
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<LeaveType | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const fetchTypes = () => {
    setLoading(true);
    fetch('/api/leave-types?all=1').then(r => r.json()).then(d => { setTypes(Array.isArray(d) ? d : []); setLoading(false); });
  };
  useEffect(fetchTypes, []);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setShowAdd(true)} className="btn-primary"><Plus size={16} /> Add Leave Type</button>
      </div>
      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-300" size={24} /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="table-header">Name</th>
                  <th className="table-header">Paid</th>
                  <th className="table-header">Status</th>
                  <th className="table-header">Annual Credits</th>
                  <th className="table-header"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {types.map(t => (
                  <tr key={t.id} className="hover:bg-gray-50/60">
                    <td className="table-cell font-medium text-gray-900">{t.name}</td>
                    <td className="table-cell">{t.paid ? <span className="badge-green">Paid</span> : <span className="badge-gray">Unpaid</span>}</td>
                    <td className="table-cell">{t.active ? <span className="badge-blue">Active</span> : <span className="badge-gray">Inactive</span>}</td>
                    <td className="table-cell">{t.annual_credits ?? '—'}</td>
                    <td className="table-cell"><button onClick={() => setEditing(t)} className="text-xs text-orange-600 hover:text-orange-700 font-medium">Edit</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {(showAdd || editing) && (
        <Modal open={true} onClose={() => { setShowAdd(false); setEditing(null); }} title={editing ? 'Edit Leave Type' : 'Add Leave Type'} size="sm">
          <LeaveTypeForm
            leaveType={editing}
            onCancel={() => { setShowAdd(false); setEditing(null); }}
            onSaved={() => { setShowAdd(false); setEditing(null); showToast(editing ? 'Leave type updated!' : 'Leave type created!'); fetchTypes(); }}
          />
        </Modal>
      )}
    </div>
  );
}

function LeaveTypeForm({ leaveType, onCancel, onSaved }: { leaveType: LeaveType | null; onCancel: () => void; onSaved: () => void }) {
  const [name, setName] = useState(leaveType?.name ?? '');
  const [paid, setPaid] = useState(leaveType ? !!leaveType.paid : true);
  const [active, setActive] = useState(leaveType ? !!leaveType.active : true);
  const [credits, setCredits] = useState(leaveType?.annual_credits != null ? String(leaveType.annual_credits) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!name.trim()) { setError('Name is required.'); return; }
    setSaving(true);
    setError('');
    try {
      const url = leaveType ? `/api/leave-types/${leaveType.id}` : '/api/leave-types';
      const res = await fetch(url, {
        method: leaveType ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), paid, active, annual_credits: credits === '' ? null : Number(credits) }),
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
        <label className="form-label">Name</label>
        <input type="text" className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Vacation Leave" />
      </div>
      <div>
        <label className="form-label">Annual Credits (optional)</label>
        <input type="number" className="form-input" value={credits} onChange={e => setCredits(e.target.value)} placeholder="e.g. 15" />
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={paid} onChange={e => setPaid(e.target.checked)} /> Paid
      </label>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> Active
      </label>
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

// ── Leave Requests ───────────────────────────────────────────────────────

const REQUEST_STATUS_FILTERS = ['pending', 'approved', 'rejected', 'all'] as const;

function LeaveRequestsTab({ showToast }: { showToast: (m: string, t?: 'success' | 'error') => void }) {
  const [statusFilter, setStatusFilter] = useState<typeof REQUEST_STATUS_FILTERS[number]>('pending');
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState<any | null>(null);

  const fetchRequests = () => {
    setLoading(true);
    const url = statusFilter === 'all' ? '/api/leave-requests' : `/api/leave-requests?status=${statusFilter}`;
    fetch(url).then(r => r.json()).then(d => { setRequests(Array.isArray(d) ? d : []); setLoading(false); });
  };
  useEffect(fetchRequests, [statusFilter]);

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5">
        {REQUEST_STATUS_FILTERS.map(f => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors ${
              statusFilter === f ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-300" size={24} /></div>
        ) : requests.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-12">No leave requests found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="table-header">Employee</th>
                  <th className="table-header">Leave Type</th>
                  <th className="table-header">Dates</th>
                  <th className="table-header">Day</th>
                  <th className="table-header">Reason</th>
                  <th className="table-header">Status</th>
                  <th className="table-header"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {requests.map(r => (
                  <tr key={r.id} className="hover:bg-gray-50/60">
                    <td className="table-cell font-medium text-gray-900">{r.employee_name}</td>
                    <td className="table-cell">{r.leave_type_name} {r.leave_type_paid ? '' : <span className="text-gray-400">(Unpaid)</span>}</td>
                    <td className="table-cell">{formatDate(r.from_date)}{r.from_date !== r.to_date ? ` – ${formatDate(r.to_date)}` : ''}</td>
                    <td className="table-cell capitalize">{r.day_type}</td>
                    <td className="table-cell max-w-xs truncate" title={r.reason}>
                      {r.reason}
                      {r.attachment_path && (
                        <a href={`/api/leave-requests/attachments/${r.attachment_path}`} target="_blank" rel="noreferrer" className="ml-1.5 inline-flex items-center text-blue-500 hover:text-blue-600">
                          <Paperclip size={12} />
                        </a>
                      )}
                    </td>
                    <td className="table-cell">
                      <span className={r.status === 'approved' ? 'badge-green' : r.status === 'rejected' ? 'badge-red' : 'badge-amber'}>{r.status}</span>
                    </td>
                    <td className="table-cell">
                      {r.status === 'pending' && <button onClick={() => setReviewing(r)} className="text-xs text-orange-600 hover:text-orange-700 font-medium">Review</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {reviewing && (
        <LeaveReviewModal
          request={reviewing}
          onClose={() => setReviewing(null)}
          onDone={() => { setReviewing(null); showToast('Leave request reviewed!'); fetchRequests(); }}
        />
      )}
    </div>
  );
}

function LeaveReviewModal({ request, onClose, onDone }: { request: any; onClose: () => void; onDone: () => void }) {
  const [remarks, setRemarks] = useState('');
  const [saving, setSaving] = useState<'approve' | 'reject' | null>(null);

  const submit = async (action: 'approve' | 'reject') => {
    setSaving(action);
    try {
      const res = await fetch(`/api/leave-requests/${request.id}`, {
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
        <h2 className="text-lg font-semibold text-gray-900">Review Leave Request</h2>
        <div className="text-sm text-gray-600 space-y-1">
          <p><b>{request.employee_name}</b> — {request.leave_type_name}</p>
          <p>{formatDate(request.from_date)}{request.from_date !== request.to_date ? ` – ${formatDate(request.to_date)}` : ''} ({request.day_type} day)</p>
          <p className="text-gray-400">Reason: {request.reason}</p>
          {request.attachment_path && (
            <a href={`/api/leave-requests/attachments/${request.attachment_path}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-500 hover:text-blue-600 text-xs">
              <Paperclip size={12} /> View Attachment
            </a>
          )}
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

// ── Holiday Calendar ─────────────────────────────────────────────────────

interface Holiday {
  id: number; name: string; date: string; holiday_type: string; is_working: number;
}

const HOLIDAY_TYPES = ['Regular Holiday', 'Special Non-Working Holiday', 'Special Working Holiday'];

function HolidaysTab({ showToast }: { showToast: (m: string, t?: 'success' | 'error') => void }) {
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Holiday | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const fetchHolidays = () => {
    setLoading(true);
    fetch('/api/holidays').then(r => r.json()).then(d => { setHolidays(Array.isArray(d) ? d : []); setLoading(false); });
  };
  useEffect(fetchHolidays, []);

  const remove = async (id: number) => {
    await fetch(`/api/holidays/${id}`, { method: 'DELETE' });
    showToast('Holiday removed!');
    fetchHolidays();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setShowAdd(true)} className="btn-primary"><Plus size={16} /> Add Holiday</button>
      </div>
      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-300" size={24} /></div>
        ) : holidays.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-12">No holidays configured yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="table-header">Date</th>
                  <th className="table-header">Name</th>
                  <th className="table-header">Type</th>
                  <th className="table-header">Working?</th>
                  <th className="table-header"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {holidays.map(h => (
                  <tr key={h.id} className="hover:bg-gray-50/60">
                    <td className="table-cell">{formatDate(h.date)}</td>
                    <td className="table-cell font-medium text-gray-900">{h.name}</td>
                    <td className="table-cell">{h.holiday_type}</td>
                    <td className="table-cell">{h.is_working ? <span className="badge-blue">Working</span> : <span className="badge-gray">Non-working</span>}</td>
                    <td className="table-cell">
                      <div className="flex gap-2">
                        <button onClick={() => setEditing(h)} className="text-xs text-orange-600 hover:text-orange-700 font-medium">Edit</button>
                        <button onClick={() => remove(h.id)} className="text-xs text-red-500 hover:text-red-600 font-medium">Remove</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {(showAdd || editing) && (
        <Modal open={true} onClose={() => { setShowAdd(false); setEditing(null); }} title={editing ? 'Edit Holiday' : 'Add Holiday'} size="sm">
          <HolidayForm
            holiday={editing}
            onCancel={() => { setShowAdd(false); setEditing(null); }}
            onSaved={() => { setShowAdd(false); setEditing(null); showToast(editing ? 'Holiday updated!' : 'Holiday added!'); fetchHolidays(); }}
          />
        </Modal>
      )}
    </div>
  );
}

function HolidayForm({ holiday, onCancel, onSaved }: { holiday: Holiday | null; onCancel: () => void; onSaved: () => void }) {
  const [name, setName] = useState(holiday?.name ?? '');
  const [date, setDate] = useState(holiday?.date ?? todayISO());
  const [holidayType, setHolidayType] = useState(holiday?.holiday_type ?? 'Regular Holiday');
  const [isWorking, setIsWorking] = useState(holiday ? !!holiday.is_working : false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!name.trim() || !date) { setError('Name and date are required.'); return; }
    setSaving(true);
    setError('');
    try {
      const url = holiday ? `/api/holidays/${holiday.id}` : '/api/holidays';
      const res = await fetch(url, {
        method: holiday ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), date, holiday_type: holidayType, is_working: isWorking }),
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
        <label className="form-label">Holiday Name</label>
        <input type="text" className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Araw ng Kagitingan" />
      </div>
      <div>
        <label className="form-label">Date</label>
        <input type="date" className="form-input" value={date} onChange={e => setDate(e.target.value)} />
      </div>
      <div>
        <label className="form-label">Holiday Type</label>
        <select className="form-input" value={holidayType} onChange={e => setHolidayType(e.target.value)}>
          {HOLIDAY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={isWorking} onChange={e => setIsWorking(e.target.checked)} /> Working Holiday (employees still expected to clock in)
      </label>
      <p className="text-xs text-gray-400">Leave unchecked for a non-working holiday — employees won't be marked Absent that day even without a Time In.</p>
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

// ── Attendance Exceptions ────────────────────────────────────────────────

const EXCEPTION_TYPES: { value: string; label: string }[] = [
  { value: 'official_business', label: 'Official Business' },
  { value: 'authorized_absence', label: 'Authorized Absence' },
  { value: 'company_event', label: 'Company Event / Special Schedule' },
];
const EXCEPTION_LABELS: Record<string, string> = Object.fromEntries(EXCEPTION_TYPES.map(t => [t.value, t.label]));

function ExceptionsTab({ showToast }: { showToast: (m: string, t?: 'success' | 'error') => void }) {
  const [exceptions, setExceptions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  const fetchExceptions = () => {
    setLoading(true);
    fetch('/api/attendance-exceptions').then(r => r.json()).then(d => { setExceptions(Array.isArray(d) ? d : []); setLoading(false); });
  };
  useEffect(fetchExceptions, []);

  const remove = async (id: number) => {
    await fetch(`/api/attendance-exceptions/${id}`, { method: 'DELETE' });
    showToast('Exception removed!');
    fetchExceptions();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-xs text-gray-400 max-w-md">Records an admin-approved exception directly — no separate review step, since creating it here is the approval.</p>
        <button onClick={() => setShowAdd(true)} className="btn-primary"><Plus size={16} /> Add Exception</button>
      </div>
      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-300" size={24} /></div>
        ) : exceptions.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-12">No attendance exceptions recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="table-header">Employee</th>
                  <th className="table-header">Type</th>
                  <th className="table-header">Dates</th>
                  <th className="table-header">Paid</th>
                  <th className="table-header">Reason</th>
                  <th className="table-header"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {exceptions.map(ex => (
                  <tr key={ex.id} className="hover:bg-gray-50/60">
                    <td className="table-cell font-medium text-gray-900">{ex.employee_name}</td>
                    <td className="table-cell">{EXCEPTION_LABELS[ex.exception_type] ?? ex.exception_type}</td>
                    <td className="table-cell">{formatDate(ex.from_date)}{ex.from_date !== ex.to_date ? ` – ${formatDate(ex.to_date)}` : ''}</td>
                    <td className="table-cell">{ex.paid ? <span className="badge-green">Paid</span> : <span className="badge-gray">Unpaid</span>}</td>
                    <td className="table-cell max-w-xs truncate" title={ex.reason}>{ex.reason || '—'}</td>
                    <td className="table-cell"><button onClick={() => remove(ex.id)} className="text-xs text-red-500 hover:text-red-600 font-medium">Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAdd && (
        <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add Attendance Exception" size="sm">
          <ExceptionForm onCancel={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); showToast('Exception recorded!'); fetchExceptions(); }} />
        </Modal>
      )}
    </div>
  );
}

function ExceptionForm({ onCancel, onSaved }: { onCancel: () => void; onSaved: () => void }) {
  const [employees, setEmployees] = useState<{ id: number; name: string }[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [exceptionType, setExceptionType] = useState('official_business');
  const [fromDate, setFromDate] = useState(todayISO());
  const [toDate, setToDate] = useState(todayISO());
  const [paid, setPaid] = useState(true);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/attendance/employees').then(r => r.json()).then(d => setEmployees(Array.isArray(d) ? d : []));
  }, []);

  const save = async () => {
    if (!employeeId) { setError('Select an employee.'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/attendance-exceptions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: Number(employeeId), exception_type: exceptionType, from_date: fromDate, to_date: toDate, paid, reason: reason.trim() || null }),
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
        <label className="form-label">Employee</label>
        <select className="form-input" value={employeeId} onChange={e => setEmployeeId(e.target.value)}>
          <option value="">Select employee...</option>
          {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </div>
      <div>
        <label className="form-label">Exception Type</label>
        <select className="form-input" value={exceptionType} onChange={e => setExceptionType(e.target.value)}>
          {EXCEPTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="form-label">From Date</label>
          <input type="date" className="form-input" value={fromDate} onChange={e => setFromDate(e.target.value)} />
        </div>
        <div>
          <label className="form-label">To Date</label>
          <input type="date" className="form-input" value={toDate} onChange={e => setToDate(e.target.value)} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={paid} onChange={e => setPaid(e.target.checked)} /> Paid
      </label>
      <div>
        <label className="form-label">Reason (optional)</label>
        <textarea className="form-input" rows={2} value={reason} onChange={e => setReason(e.target.value)} />
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
