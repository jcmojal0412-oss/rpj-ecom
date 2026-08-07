'use client';

import { useEffect, useState } from 'react';
import { Clock, Coffee, Utensils, LogIn, LogOut, Camera, FileEdit, Loader2 } from 'lucide-react';
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

interface TodayResp {
  date: string;
  events: TodayEvent[];
  dayState: DayStateResp;
  requiresSelfie: Record<string, boolean>;
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

function toDateTimeLocalValue(iso: string) {
  const d = new Date(new Date(iso).getTime() + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 16);
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

  const fetchToday = () => {
    fetch('/api/attendance/today').then(r => r.json()).then(d => { setToday(d); setLoading(false); });
  };

  const fetchCorrections = () => {
    fetch('/api/attendance/corrections?self=1').then(r => r.json()).then(d => setCorrections(Array.isArray(d) ? d : []));
  };

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(u => { if (u) setUserName(u.name); });
    fetchToday();
    fetchCorrections();
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

  if (loading || !today) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="animate-spin text-orange-500" size={28} />
      </div>
    );
  }

  const { dayState } = today;

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
        {dayState.coffeeBreaksUsed > 0 || dayState.coffeeBreaksRemaining >= 0 ? (
          <p className="text-xs text-gray-500">
            Coffee breaks used: {dayState.coffeeBreaksUsed} · remaining: {dayState.coffeeBreaksRemaining}
          </p>
        ) : null}

        {today.events.filter(e => !e.superseded_by).length > 0 && (
          <div className="border-t border-gray-100 pt-3 space-y-1.5">
            {today.events.filter(e => !e.superseded_by).map(e => (
              <div key={e.id} className="flex items-center justify-between text-sm">
                <span className="text-gray-600">{EVENT_LABELS[e.event_type]}</span>
                <span className="font-medium text-gray-800">{formatPHTime(e.event_time)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

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
