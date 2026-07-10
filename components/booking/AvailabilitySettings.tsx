'use client';

import { useEffect, useState } from 'react';
import { Loader2, Copy, Check, Calendar, ExternalLink } from 'lucide-react';

interface DayRow {
  day_of_week: number;
  start_time: string;
  end_time: string;
  enabled: number;
}

interface GoogleCalendarStatus {
  configured: boolean;
  connected: boolean;
  email: string | null;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function AvailabilitySettings({ onClose }: { onClose: () => void }) {
  const [days, setDays] = useState<DayRow[]>([]);
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [minNoticeHours, setMinNoticeHours] = useState(2);
  const [zoomLink, setZoomLink] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const [gcalStatus, setGcalStatus] = useState<GoogleCalendarStatus | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const loadGcalStatus = () => {
    fetch('/api/settings/google-calendar/status').then(r => r.json()).then(setGcalStatus);
  };

  useEffect(() => {
    fetch('/api/settings/availability').then(r => r.json()).then(d => {
      setDays(d.days ?? []);
      setDurationMinutes(d.durationMinutes ?? 60);
      setMinNoticeHours(d.minNoticeHours ?? 2);
      setZoomLink(d.zoomLink ?? '');
      setLoading(false);
    });
    loadGcalStatus();
  }, []);

  const handleDisconnectGcal = async () => {
    setDisconnecting(true);
    try {
      await fetch('/api/settings/google-calendar/disconnect', { method: 'POST' });
      loadGcalStatus();
    } finally {
      setDisconnecting(false);
    }
  };

  const updateDay = (dow: number, patch: Partial<DayRow>) =>
    setDays(prev => prev.map(d => d.day_of_week === dow ? { ...d, ...patch } : d));

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await fetch('/api/settings/availability', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days, durationMinutes, minNoticeHours, zoomLink }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const bookingUrl = typeof window !== 'undefined' ? `${window.location.origin}/book/discovery-call` : '/book/discovery-call';

  const copyLink = () => {
    navigator.clipboard.writeText(bookingUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-300" size={24} /></div>;
  }

  return (
    <div className="space-y-5">
      <div className="bg-gray-50 rounded-xl p-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-gray-500">Public Booking Link</p>
          <p className="text-sm text-gray-800 truncate">{bookingUrl}</p>
        </div>
        <button onClick={copyLink} className="btn-secondary text-xs py-1.5 shrink-0">
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <div className="bg-gray-50 rounded-xl p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-500 flex items-center gap-1.5"><Calendar size={13} /> Google Calendar</p>
            {!gcalStatus ? (
              <p className="text-sm text-gray-400 mt-0.5">Checking...</p>
            ) : !gcalStatus.configured ? (
              <p className="text-sm text-gray-400 mt-0.5">Not set up yet — needs Google API credentials.</p>
            ) : gcalStatus.connected ? (
              <p className="text-sm text-gray-800 mt-0.5 truncate">Connected as {gcalStatus.email}</p>
            ) : (
              <p className="text-sm text-gray-400 mt-0.5">Not connected — bookings won't sync to a calendar.</p>
            )}
          </div>
          {gcalStatus?.configured && (
            gcalStatus.connected ? (
              <button onClick={handleDisconnectGcal} disabled={disconnecting} className="btn-secondary text-xs py-1.5 shrink-0 disabled:opacity-50">
                {disconnecting ? <Loader2 size={13} className="animate-spin" /> : null}
                Disconnect
              </button>
            ) : (
              <a href="/api/settings/google-calendar/connect" className="btn-primary text-xs py-1.5 shrink-0">
                <ExternalLink size={13} /> Connect
              </a>
            )
          )}
        </div>
        <p className="text-xs text-gray-400 mt-2">Every new booking is automatically added to this calendar.</p>
      </div>

      <div>
        <label className="form-label">Zoom Meeting Link</label>
        <input type="url" className="form-input" placeholder="https://zoom.us/j/..."
          value={zoomLink} onChange={e => setZoomLink(e.target.value)} />
        <p className="text-xs text-gray-400 mt-1">Shown to the customer right after they book.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="form-label">Call Duration (minutes)</label>
          <input type="number" min={15} step={15} className="form-input"
            value={durationMinutes} onChange={e => setDurationMinutes(Number(e.target.value))} />
        </div>
        <div>
          <label className="form-label">Minimum Notice (hours)</label>
          <input type="number" min={0} step={0.5} className="form-input"
            value={minNoticeHours} onChange={e => setMinNoticeHours(Number(e.target.value))} />
        </div>
      </div>

      <div>
        <p className="form-label mb-2">Weekly Availability</p>
        <div className="space-y-2">
          {days.map(d => (
            <div key={d.day_of_week} className={`flex items-center gap-3 rounded-lg px-3 py-2 ${d.enabled ? 'bg-orange-50/50' : 'bg-gray-50'}`}>
              <input
                type="checkbox"
                checked={!!d.enabled}
                onChange={e => updateDay(d.day_of_week, { enabled: e.target.checked ? 1 : 0 })}
                className="w-4 h-4 text-orange-500 rounded border-gray-300 focus:ring-orange-400"
              />
              <span className="text-sm font-medium text-gray-700 w-24 shrink-0">{DAY_NAMES[d.day_of_week]}</span>
              <input type="time" className="form-input py-1 text-xs w-auto" value={d.start_time}
                disabled={!d.enabled}
                onChange={e => updateDay(d.day_of_week, { start_time: e.target.value })} />
              <span className="text-gray-400 text-xs">to</span>
              <input type="time" className="form-input py-1 text-xs w-auto" value={d.end_time}
                disabled={!d.enabled}
                onChange={e => updateDay(d.day_of_week, { end_time: e.target.value })} />
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button onClick={onClose} className="btn-secondary">Close</button>
        <button onClick={handleSave} disabled={saving} className="btn-primary disabled:opacity-50">
          {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : null}
          {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Availability'}
        </button>
      </div>
    </div>
  );
}
