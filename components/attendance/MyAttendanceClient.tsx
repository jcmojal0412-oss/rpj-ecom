'use client';

import { useEffect, useState } from 'react';
import { Clock, Coffee, Utensils, LogIn, LogOut, Camera, FileEdit, Loader2, Palmtree, Paperclip } from 'lucide-react';
import { Toast, useToast } from '@/components/ui/Toast';
import Modal from '@/components/ui/Modal';
import SelfieCaptureModal from './SelfieCaptureModal';
import type { EventType, DayState } from '@/lib/attendance';

interface TodayEvent {
  id: number;
  event_type: EventType;
  event_time: string;
  superseded_by: number | null;
}

interface DayStateResp {
  state: DayState;
  coffeeBreaksUsed: number;
  coffeeBreaksRemaining: number;
  lunchTaken: boolean;
  canTimeIn: boolean; canTimeOut: boolean;
  canLunchOut: boolean; canLunchIn: boolean;
  canCoffeeOut: boolean; canCoffeeIn: boolean;
}

interface DaySummary {
  status: string;
  totalWorkMinutes: number;
  breakMinutes: number;
  excessBreakMinutes: number;
  potentialOtMinutes: number;
  lateMinutes: number;
  undertimeMinutes: number;
}

interface OtRequest {
  status: 'pending' | 'approved' | 'rejected';
  excess_minutes: number;
  approved_minutes: number | null;
}

interface TodaySettings {
  coffee_break_minutes: number;
  lunch_break_minutes: number;
}

interface AssignedShift {
  name: string;
  start_time: string;
  end_time: string;
}

interface TodayResp {
  date: string;
  events: TodayEvent[];
  dayState: DayStateResp;
  requiresSelfie: Record<string, boolean>;
  summary: DaySummary;
  otRequest: OtRequest | null;
  settings: TodaySettings;
  shift: AssignedShift;
}

interface Correction {
  id: number;
  event_date: string;
  requested_event_type: EventType;
  requested_time: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  remarks: string | null;
  created_at: string;
}

const ACTIONS: { type: EventType; label: string; canKey: keyof DayStateResp; icon: typeof Clock }[] = [
  { type: 'TIME_IN', label: 'Work Time In', canKey: 'canTimeIn', icon: LogIn },
  { type: 'COFFEE_OUT', label: 'Coffee Break Out', canKey: 'canCoffeeOut', icon: Coffee },
  { type: 'COFFEE_IN', label: 'Coffee Break In', canKey: 'canCoffeeIn', icon: Coffee },
  { type: 'LUNCH_OUT', label: 'Lunch Break Out', canKey: 'canLunchOut', icon: Utensils },
  { type: 'LUNCH_IN', label: 'Lunch Break In', canKey: 'canLunchIn', icon: Utensils },
  { type: 'TIME_OUT', label: 'Work Time Out', canKey: 'canTimeOut', icon: LogOut },
];

const STATE_LABELS: Record<DayState, string> = {
  not_started: 'Not Clocked In',
  working: 'Working',
  on_lunch: 'On Lunch Break',
  on_coffee: 'On Coffee Break',
  ended: 'Clocked Out',
};

const EVENT_LABELS: Record<EventType, string> = {
  TIME_IN: 'Work Time In',
  COFFEE_OUT: 'Coffee Break Out',
  COFFEE_IN: 'Coffee Break In',
  LUNCH_OUT: 'Lunch Break Out',
  LUNCH_IN: 'Lunch Break In',
  TIME_OUT: 'Work Time Out',
};

function formatPHTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' });
}

function fmtShiftTime(t: string) {
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function toDateTimeLocalValue(iso: string) {
  const d = new Date(new Date(iso).getTime() + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 16);
}

function fmtMinutes(m: number) {
  const h = Math.floor(m / 60), mm = m % 60;
  return h > 0 ? `${h}h ${mm}m` : `${mm}m`;
}

function fmtMMSS(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export default function MyAttendanceClient() {
  const { toast, showToast, clearToast } = useToast();
  const [userName, setUserName] = useState('');
  const [today, setToday] = useState<TodayResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<EventType | null>(null);
  const [selfieFor, setSelfieFor] = useState<EventType | null>(null);
  const [showCorrectionForm, setShowCorrectionForm] = useState(false);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [showLeaveForm, setShowLeaveForm] = useState(false);
  const [leaveRequests, setLeaveRequests] = useState<any[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Ticks every second so the live break timer stays accurate — purely a
  // re-render trigger, doesn't refetch anything.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const [noShiftError, setNoShiftError] = useState('');

  const fetchToday = () => {
    fetch('/api/attendance/today').then(async r => {
      const d = await r.json();
      if (!r.ok) { setNoShiftError(d.error || 'Unable to load attendance.'); setLoading(false); return; }
      setNoShiftError('');
      setToday(d);
      setLoading(false);
    });
  };

  const fetchCorrections = () => {
    fetch('/api/attendance/corrections?self=1').then(r => r.json()).then(d => setCorrections(Array.isArray(d) ? d : []));
  };

  const fetchLeaveRequests = () => {
    fetch('/api/leave-requests?self=1').then(r => r.json()).then(d => setLeaveRequests(Array.isArray(d) ? d : []));
  };

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(u => { if (u) setUserName(u.name); });
    fetchToday();
    fetchCorrections();
    fetchLeaveRequests();
  }, []);

  const submitClock = async (eventType: EventType, photoPath?: string) => {
    setPendingAction(eventType);
    try {
      const res = await fetch('/api/attendance/clock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_type: eventType, photo_path: photoPath || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Failed to record.', 'error');
        return;
      }
      showToast(`${EVENT_LABELS[eventType]} recorded!`);
      fetchToday();
    } finally {
      setPendingAction(null);
    }
  };

  const handleAction = (eventType: EventType) => {
    if (!today) return;
    if (today.requiresSelfie[eventType]) {
      setSelfieFor(eventType);
    } else {
      submitClock(eventType);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="animate-spin text-orange-500" size={28} />
      </div>
    );
  }

  if (noShiftError || !today) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="card max-w-sm text-center">
          <p className="text-sm text-red-600">{noShiftError || 'Unable to load your attendance.'}</p>
        </div>
      </div>
    );
  }

  const { dayState, summary, otRequest } = today;
  const activeEvents = today.events.filter(e => !e.superseded_by).sort((a, b) => a.event_time.localeCompare(b.event_time));
  const lastEvent = activeEvents[activeEvents.length - 1];

  // Live break timer — only while currently on a break, comparing elapsed
  // time (ticking every second via nowMs) against the configured allowed
  // duration for that break type.
  const onBreak = dayState.state === 'on_coffee' || dayState.state === 'on_lunch';
  const breakStartMs = onBreak && lastEvent ? new Date(lastEvent.event_time).getTime() : null;
  const allowedBreakMinutes = dayState.state === 'on_coffee' ? today.settings.coffee_break_minutes : today.settings.lunch_break_minutes;
  const elapsedSeconds = breakStartMs != null ? (nowMs - breakStartMs) / 1000 : 0;
  const overBreakLimit = breakStartMs != null && elapsedSeconds > allowedBreakMinutes * 60;

  const otBadge = otRequest && (
    otRequest.status === 'pending' ? <span className="badge-blue">Potential OT – Pending Approval ({fmtMinutes(otRequest.excess_minutes)})</span> :
    otRequest.status === 'approved' ? <span className="badge-green">OT Approved: {fmtMinutes(otRequest.approved_minutes ?? 0)}</span> :
    <span className="badge-red">OT Rejected</span>
  );

  return (
    <div className="min-h-screen bg-gray-50 p-4 py-6 space-y-4 max-w-lg mx-auto">
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}

      <div>
        <h1 className="text-xl font-bold text-gray-900">My Attendance</h1>
        <p className="text-sm text-gray-500 mt-0.5">{userName}</p>
      </div>

      {/* Status card */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="text-orange-500" size={18} />
            <span className="font-semibold text-gray-900">{STATE_LABELS[dayState.state]}</span>
          </div>
          <span className="text-xs text-gray-400">{today.date}</span>
        </div>
        <p className="text-xs text-gray-500">
          {today.shift.name} · {fmtShiftTime(today.shift.start_time)} – {fmtShiftTime(today.shift.end_time)}
        </p>
        {dayState.coffeeBreaksUsed > 0 || dayState.coffeeBreaksRemaining >= 0 ? (
          <p className="text-xs text-gray-500">
            Coffee breaks used: {dayState.coffeeBreaksUsed} · remaining: {dayState.coffeeBreaksRemaining}
          </p>
        ) : null}

        {onBreak && breakStartMs != null && (
          <div className={`rounded-lg p-3 text-center ${overBreakLimit ? 'bg-red-50' : 'bg-orange-50'}`}>
            <p className={`text-2xl font-bold tabular-nums ${overBreakLimit ? 'text-red-600' : 'text-orange-600'}`}>
              {fmtMMSS(elapsedSeconds)}
            </p>
            <p className={`text-xs mt-0.5 ${overBreakLimit ? 'text-red-500' : 'text-orange-500'}`}>
              {overBreakLimit ? 'Over the ' : 'of the '}{allowedBreakMinutes}-minute allowed break
            </p>
          </div>
        )}
      </div>

      {/* Today's summary */}
      <div className="card space-y-2.5">
        <p className="text-sm font-semibold text-gray-700">Today's Summary</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div className="flex justify-between"><span className="text-gray-500">Worked Hours</span><span className="font-medium text-gray-800">{fmtMinutes(summary.totalWorkMinutes)}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Break Time</span><span className="font-medium text-gray-800">{fmtMinutes(summary.breakMinutes)}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Late</span><span className="font-medium text-gray-800">{summary.lateMinutes > 0 ? fmtMinutes(summary.lateMinutes) : '—'}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Undertime</span><span className="font-medium text-gray-800">{summary.undertimeMinutes > 0 ? fmtMinutes(summary.undertimeMinutes) : '—'}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Excess Break</span><span className="font-medium text-gray-800">{summary.excessBreakMinutes > 0 ? fmtMinutes(summary.excessBreakMinutes) : '—'}</span></div>
        </div>
        {otBadge && <div className="pt-1">{otBadge}</div>}
      </div>

      {/* Today's timeline */}
      {activeEvents.length > 0 && (
        <div className="card space-y-1.5">
          <p className="text-sm font-semibold text-gray-700 mb-1">Today's Timeline</p>
          {activeEvents.map(e => (
            <div key={e.id} className="flex items-center justify-between text-sm border-t border-gray-50 pt-1.5 first:border-t-0 first:pt-0">
              <span className="text-gray-600">{EVENT_LABELS[e.event_type]}</span>
              <span className="font-medium text-gray-800">{formatPHTime(e.event_time)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Action buttons */}
      <div className="grid grid-cols-2 gap-2.5">
        {ACTIONS.map(({ type, label, canKey, icon: Icon }) => {
          const enabled = dayState[canKey] as boolean;
          return (
            <button
              key={type}
              onClick={() => handleAction(type)}
              disabled={!enabled || pendingAction !== null}
              className={`flex flex-col items-center justify-center gap-1.5 rounded-xl p-4 text-sm font-semibold transition-colors ${
                enabled
                  ? 'bg-orange-500 text-white hover:bg-orange-600'
                  : 'bg-gray-100 text-gray-400'
              } disabled:opacity-60`}
            >
              {pendingAction === type ? <Loader2 size={20} className="animate-spin" /> : <Icon size={20} />}
              <span className="text-center leading-tight">{label}</span>
              {today.requiresSelfie[type] && enabled && <Camera size={12} className="opacity-70" />}
            </button>
          );
        })}
      </div>

      {/* Correction request */}
      <button onClick={() => setShowCorrectionForm(true)} className="btn-secondary w-full justify-center">
        <FileEdit size={15} /> Request Correction
      </button>

      {corrections.length > 0 && (
        <div className="card space-y-2">
          <p className="text-sm font-semibold text-gray-700">My Correction Requests</p>
          {corrections.map(c => (
            <div key={c.id} className="flex items-center justify-between text-xs border-t border-gray-50 pt-2 first:border-t-0 first:pt-0">
              <div>
                <p className="text-gray-700 font-medium">{EVENT_LABELS[c.requested_event_type]} — {c.event_date}</p>
                <p className="text-gray-400">{c.reason}</p>
              </div>
              <span className={
                c.status === 'approved' ? 'badge-green' : c.status === 'rejected' ? 'badge-red' : 'badge-amber'
              }>
                {c.status}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Leave request */}
      <button onClick={() => setShowLeaveForm(true)} className="btn-secondary w-full justify-center">
        <Palmtree size={15} /> Request Leave
      </button>

      {leaveRequests.length > 0 && (
        <div className="card space-y-2">
          <p className="text-sm font-semibold text-gray-700">My Leave Requests</p>
          {leaveRequests.map(l => (
            <div key={l.id} className="flex items-center justify-between text-xs border-t border-gray-50 pt-2 first:border-t-0 first:pt-0">
              <div>
                <p className="text-gray-700 font-medium">
                  {l.leave_type_name} — {l.from_date}{l.from_date !== l.to_date ? ` to ${l.to_date}` : ''}
                  {l.attachment_path && <Paperclip size={11} className="inline ml-1 text-gray-400" />}
                </p>
                <p className="text-gray-400">{l.reason}</p>
              </div>
              <span className={
                l.status === 'approved' ? 'badge-green' : l.status === 'rejected' ? 'badge-red' : 'badge-amber'
              }>
                {l.status}
              </span>
            </div>
          ))}
        </div>
      )}

      {selfieFor && (
        <Modal open={!!selfieFor} onClose={() => setSelfieFor(null)} title={`Selfie for ${EVENT_LABELS[selfieFor]}`} size="sm">
          <SelfieCaptureModal
            onClose={() => setSelfieFor(null)}
            onCaptured={photoPath => { const type = selfieFor; setSelfieFor(null); if (type) submitClock(type, photoPath); }}
          />
        </Modal>
      )}

      {showCorrectionForm && (
        <Modal open={showCorrectionForm} onClose={() => setShowCorrectionForm(false)} title="Request Correction" size="sm">
          <CorrectionForm
            onCancel={() => setShowCorrectionForm(false)}
            onSubmitted={() => { setShowCorrectionForm(false); showToast('Correction request submitted!'); fetchCorrections(); }}
          />
        </Modal>
      )}

      {showLeaveForm && (
        <Modal open={showLeaveForm} onClose={() => setShowLeaveForm(false)} title="Request Leave" size="sm">
          <LeaveRequestForm
            onCancel={() => setShowLeaveForm(false)}
            onSubmitted={() => { setShowLeaveForm(false); showToast('Leave request submitted!'); fetchLeaveRequests(); }}
          />
        </Modal>
      )}
    </div>
  );
}

function CorrectionForm({ onCancel, onSubmitted }: { onCancel: () => void; onSubmitted: () => void }) {
  const [eventDate, setEventDate] = useState(() => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10));
  const [eventType, setEventType] = useState<EventType>('TIME_IN');
  const [requestedTime, setRequestedTime] = useState(() => toDateTimeLocalValue(new Date().toISOString()));
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!reason.trim()) { setError('Please explain what needs to be corrected.'); return; }
    setSaving(true);
    setError('');
    try {
      const isoTime = new Date(`${requestedTime}:00+08:00`).toISOString();
      const res = await fetch('/api/attendance/corrections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_date: eventDate, requested_event_type: eventType, requested_time: isoTime, reason: reason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to submit.'); return; }
      onSubmitted();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="form-label">Date</label>
        <input type="date" className="form-input" value={eventDate} onChange={e => setEventDate(e.target.value)} />
      </div>
      <div>
        <label className="form-label">Which action needs correcting?</label>
        <select className="form-input" value={eventType} onChange={e => setEventType(e.target.value as EventType)}>
          {Object.entries(EVENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div>
        <label className="form-label">Correct Time</label>
        <input type="datetime-local" className="form-input" value={requestedTime} onChange={e => setRequestedTime(e.target.value)} />
      </div>
      <div>
        <label className="form-label">Reason</label>
        <textarea className="form-input" rows={3} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Forgot to clock out, phone battery died" />
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="btn-secondary">Cancel</button>
        <button onClick={submit} disabled={saving} className="btn-primary disabled:opacity-50">
          {saving ? <Loader2 size={14} className="animate-spin" /> : null}
          {saving ? 'Submitting...' : 'Submit Request'}
        </button>
      </div>
    </div>
  );
}

function LeaveRequestForm({ onCancel, onSubmitted }: { onCancel: () => void; onSubmitted: () => void }) {
  const [leaveTypes, setLeaveTypes] = useState<{ id: number; name: string; paid: number }[]>([]);
  const [leaveTypeId, setLeaveTypeId] = useState('');
  const [fromDate, setFromDate] = useState(() => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10));
  const [toDate, setToDate] = useState(() => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10));
  const [dayType, setDayType] = useState<'full' | 'half'>('full');
  const [reason, setReason] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/leave-types').then(r => r.json()).then(d => {
      const list = Array.isArray(d) ? d : [];
      setLeaveTypes(list);
      if (list.length) setLeaveTypeId(String(list[0].id));
    });
  }, []);

  const submit = async () => {
    if (!leaveTypeId) { setError('Select a leave type.'); return; }
    if (!reason.trim()) { setError('Please provide a reason.'); return; }
    if (toDate < fromDate) { setError('To Date cannot be before From Date.'); return; }
    setSaving(true);
    setError('');
    try {
      let attachmentPath: string | null = null;
      if (file) {
        const fd = new FormData();
        fd.append('file', file);
        const uploadRes = await fetch('/api/leave-requests/upload-attachment', { method: 'POST', body: fd });
        const uploadData = await uploadRes.json();
        if (!uploadRes.ok) { setError(uploadData.error || 'Failed to upload attachment.'); return; }
        attachmentPath = uploadData.path;
      }
      const res = await fetch('/api/leave-requests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leave_type_id: Number(leaveTypeId), from_date: fromDate, to_date: toDate, day_type: dayType, reason: reason.trim(), attachment_path: attachmentPath }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to submit.'); return; }
      onSubmitted();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="form-label">Leave Type</label>
        <select className="form-input" value={leaveTypeId} onChange={e => setLeaveTypeId(e.target.value)}>
          {leaveTypes.map(t => <option key={t.id} value={t.id}>{t.name}{t.paid ? '' : ' (Unpaid)'}</option>)}
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
      <div>
        <label className="form-label">Day Type</label>
        <div className="flex gap-2">
          <button type="button" onClick={() => setDayType('full')} className={`flex-1 py-1.5 rounded-lg text-sm font-medium ${dayType === 'full' ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600'}`}>Full Day</button>
          <button type="button" onClick={() => setDayType('half')} className={`flex-1 py-1.5 rounded-lg text-sm font-medium ${dayType === 'half' ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600'}`}>Half Day</button>
        </div>
      </div>
      <div>
        <label className="form-label">Reason</label>
        <textarea className="form-input" rows={3} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Family emergency, medical appointment" />
      </div>
      <div>
        <label className="form-label">Attachment (optional)</label>
        <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="form-input" onChange={e => setFile(e.target.files?.[0] ?? null)} />
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="btn-secondary">Cancel</button>
        <button onClick={submit} disabled={saving} className="btn-primary disabled:opacity-50">
          {saving ? <Loader2 size={14} className="animate-spin" /> : null}
          {saving ? 'Submitting...' : 'Submit Request'}
        </button>
      </div>
    </div>
  );
}
