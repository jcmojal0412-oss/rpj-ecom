'use client';

import { useEffect, useState } from 'react';
import { Loader2, Copy, Check, Calendar, ExternalLink, Plus, X } from 'lucide-react';
import { Toast, useToast } from '@/components/ui/Toast';

interface Range {
  start_time: string;
  end_time: string;
}

interface RangeRow extends Range {
  day_of_week: number;
  enabled: number;
}

interface GoogleCalendarStatus {
  configured: boolean;
  connected: boolean;
  email: string | null;
}

type FieldMode = 'required' | 'optional' | 'hidden';
interface FieldConfig {
  contact: FieldMode;
  experience: FieldMode;
  goal: FieldMode;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const FIELD_MODES: { value: FieldMode; label: string }[] = [
  { value: 'required', label: 'Required' },
  { value: 'optional', label: 'Optional' },
  { value: 'hidden', label: 'Hidden' },
];

function groupRanges(rows: RangeRow[]): Record<number, Range[]> {
  const byDay: Record<number, Range[]> = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  for (const r of rows) {
    if (!r.enabled) continue;
    byDay[r.day_of_week].push({ start_time: r.start_time, end_time: r.end_time });
  }
  return byDay;
}

export default function BookingSettingsPage() {
  const [tab, setTab] = useState<'availability' | 'experience'>('availability');
  const { toast, showToast, clearToast } = useToast();

  // Booking Availability tab
  const [rangesByDay, setRangesByDay] = useState<Record<number, Range[]>>({});
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [minNoticeHours, setMinNoticeHours] = useState(2);
  const [zoomLink, setZoomLink] = useState('');
  const [loadingAvailability, setLoadingAvailability] = useState(true);
  const [savingAvailability, setSavingAvailability] = useState(false);
  const [copied, setCopied] = useState(false);

  const [gcalStatus, setGcalStatus] = useState<GoogleCalendarStatus | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  // Booking Experience tab
  const [fieldConfig, setFieldConfig] = useState<FieldConfig>({ contact: 'optional', experience: 'optional', goal: 'optional' });
  const [loadingFields, setLoadingFields] = useState(true);
  const [savingFields, setSavingFields] = useState(false);

  const loadAvailability = () => {
    setLoadingAvailability(true);
    fetch('/api/settings/availability').then(r => r.json()).then(d => {
      setRangesByDay(groupRanges(d.ranges ?? []));
      setDurationMinutes(d.durationMinutes ?? 60);
      setMinNoticeHours(d.minNoticeHours ?? 2);
      setZoomLink(d.zoomLink ?? '');
      setLoadingAvailability(false);
    });
  };

  const loadGcalStatus = () => {
    fetch('/api/settings/google-calendar/status').then(r => r.json()).then(setGcalStatus);
  };

  const loadFields = () => {
    setLoadingFields(true);
    fetch('/api/settings/booking-fields').then(r => r.json()).then(d => {
      setFieldConfig({
        contact: d.contact ?? 'optional',
        experience: d.experience ?? 'optional',
        goal: d.goal ?? 'optional',
      });
      setLoadingFields(false);
    });
  };

  useEffect(() => {
    loadAvailability();
    loadGcalStatus();
    loadFields();
  }, []);

  // Land here after the Google Calendar OAuth redirect (?gcal=connected|error)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gcal = params.get('gcal');
    if (!gcal) return;
    setTab('availability');
    if (gcal === 'connected') showToast('Google Calendar connected!');
    else if (gcal === 'error') showToast('Failed to connect Google Calendar. Please try again.', 'error');
    window.history.replaceState({}, '', '/sedo-bookings');
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const addRange = (day: number) => {
    setRangesByDay(prev => ({ ...prev, [day]: [...(prev[day] ?? []), { start_time: '09:00', end_time: '17:00' }] }));
  };

  const removeRange = (day: number, index: number) => {
    setRangesByDay(prev => ({ ...prev, [day]: prev[day].filter((_, i) => i !== index) }));
  };

  const updateRange = (day: number, index: number, patch: Partial<Range>) => {
    setRangesByDay(prev => ({
      ...prev,
      [day]: prev[day].map((r, i) => i === index ? { ...r, ...patch } : r),
    }));
  };

  const handleSaveAvailability = async () => {
    setSavingAvailability(true);
    try {
      const ranges: RangeRow[] = [];
      for (let day = 0; day <= 6; day++) {
        for (const r of rangesByDay[day] ?? []) {
          ranges.push({ day_of_week: day, start_time: r.start_time, end_time: r.end_time, enabled: 1 });
        }
      }
      await fetch('/api/settings/availability', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ranges, durationMinutes, minNoticeHours, zoomLink }),
      });
      showToast('Booking availability saved!');
    } catch {
      showToast('Failed to save. Please try again.', 'error');
    } finally {
      setSavingAvailability(false);
    }
  };

  const handleSaveFields = async () => {
    setSavingFields(true);
    try {
      await fetch('/api/settings/booking-fields', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fieldConfig),
      });
      showToast('Booking experience saved!');
    } catch {
      showToast('Failed to save. Please try again.', 'error');
    } finally {
      setSavingFields(false);
    }
  };

  const bookingUrl = typeof window !== 'undefined' ? `${window.location.origin}/book/discovery-call` : '/book/discovery-call';

  const copyLink = () => {
    navigator.clipboard.writeText(bookingUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}

      <div>
        <h1 className="text-2xl font-bold text-gray-900">SEDO Bookings</h1>
        <p className="text-sm text-gray-500 mt-1">Weekly availability, Zoom, Google Calendar, and booking form settings</p>
      </div>

      <div className="flex gap-1">
        {(['availability', 'experience'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              tab === t ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {t === 'availability' ? 'Booking Availability' : 'Booking Experience'}
          </button>
        ))}
      </div>

      {tab === 'availability' ? (
        loadingAvailability ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-300" size={24} /></div>
        ) : (
          <div className="card space-y-5">
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
                    <p className="text-sm text-gray-400 mt-0.5">Not connected — bookings won&apos;t sync to a calendar.</p>
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
              <p className="form-label mb-2">Weekly Hours</p>
              <div className="space-y-2">
                {DAY_NAMES.map((name, day) => {
                  const ranges = rangesByDay[day] ?? [];
                  return (
                    <div key={day} className={`rounded-lg px-3 py-2.5 ${ranges.length > 0 ? 'bg-orange-50/50' : 'bg-gray-50'}`}>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-700 w-24 shrink-0">{name}</span>
                        {ranges.length === 0 && <span className="text-xs text-gray-400">Unavailable</span>}
                        <button type="button" onClick={() => addRange(day)}
                          className="p-1 rounded hover:bg-orange-100 text-gray-400 hover:text-orange-600">
                          <Plus size={14} />
                        </button>
                      </div>
                      {ranges.length > 0 && (
                        <div className="space-y-1.5 mt-1.5">
                          {ranges.map((r, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <input type="time" className="form-input py-1 text-xs w-auto" value={r.start_time}
                                onChange={e => updateRange(day, i, { start_time: e.target.value })} />
                              <span className="text-gray-400 text-xs">to</span>
                              <input type="time" className="form-input py-1 text-xs w-auto" value={r.end_time}
                                onChange={e => updateRange(day, i, { end_time: e.target.value })} />
                              <button type="button" onClick={() => removeRange(day, i)}
                                className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500">
                                <X size={14} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button onClick={handleSaveAvailability} disabled={savingAvailability} className="btn-primary disabled:opacity-50">
                {savingAvailability ? <Loader2 size={14} className="animate-spin" /> : null}
                {savingAvailability ? 'Saving...' : 'Save Availability'}
              </button>
            </div>
          </div>
        )
      ) : (
        loadingFields ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-300" size={24} /></div>
        ) : (
          <div className="card space-y-5">
            <p className="text-sm text-gray-500">Control which optional fields appear on the public booking form.</p>

            {([
              { key: 'contact', label: 'Mobile Number' },
              { key: 'experience', label: 'Current Business / Experience' },
              { key: 'goal', label: 'Main Goal for Joining' },
            ] as const).map(({ key, label }) => (
              <div key={key} className="flex items-center justify-between gap-3 bg-gray-50 rounded-lg px-4 py-3">
                <span className="text-sm font-medium text-gray-700">{label}</span>
                <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
                  {FIELD_MODES.map(m => (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => setFieldConfig(prev => ({ ...prev, [key]: m.value }))}
                      className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                        fieldConfig[key] === m.value ? 'bg-white shadow-sm text-orange-600' : 'text-gray-500'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}

            <div className="flex justify-end pt-2">
              <button onClick={handleSaveFields} disabled={savingFields} className="btn-primary disabled:opacity-50">
                {savingFields ? <Loader2 size={14} className="animate-spin" /> : null}
                {savingFields ? 'Saving...' : 'Save Booking Experience'}
              </button>
            </div>
          </div>
        )
      )}
    </div>
  );
}
