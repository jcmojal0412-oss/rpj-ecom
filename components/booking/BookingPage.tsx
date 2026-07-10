'use client';

import { useEffect, useState, useCallback } from 'react';
import Image from 'next/image';
import { Clock, Video, Globe, CheckCircle2, Loader2, ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { todayISO } from '@/lib/utils';

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAY_LABELS = ['SUN','MON','TUE','WED','THU','FRI','SAT'];

function formatSlotLabel(time: string, use24h: boolean) {
  const [h, m] = time.split(':').map(Number);
  if (use24h) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function formatDateLabel(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-PH', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

type View = 'calendar' | 'form' | 'confirmed';

export default function BookingPage() {
  const today = todayISO();
  const [todayY, todayM] = today.split('-').map(Number);

  const [view, setView] = useState<View>('calendar');
  const [year, setYear] = useState(todayY);
  const [month, setMonth] = useState(todayM); // 1-12
  const [availableDays, setAvailableDays] = useState<number[]>([]);
  const [loadingMonth, setLoadingMonth] = useState(true);

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [slots, setSlots] = useState<string[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [use24h, setUse24h] = useState(false);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [contact, setContact] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [confirmedZoomLink, setConfirmedZoomLink] = useState('');

  const fetchMonth = useCallback((y: number, m: number) => {
    setLoadingMonth(true);
    fetch(`/api/public/availability/month?year=${y}&month=${m}`)
      .then(r => r.json())
      .then(d => setAvailableDays(d.availableDays ?? []))
      .finally(() => setLoadingMonth(false));
  }, []);

  useEffect(() => { fetchMonth(year, month); }, [year, month, fetchMonth]);

  const isPastMonth = year === todayY && month === todayM;

  const shiftMonth = (dir: 1 | -1) => {
    let m = month + dir, y = year;
    if (m > 12) { m = 1; y++; }
    if (m < 1) { m = 12; y--; }
    setYear(y); setMonth(m);
    setSelectedDate(null); setSlots([]); setSelectedSlot(null);
  };

  const selectDate = (day: number) => {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    setSelectedDate(dateStr);
    setSelectedSlot(null);
    setLoadingSlots(true);
    fetch(`/api/public/availability?date=${dateStr}`)
      .then(r => r.json())
      .then(d => setSlots(d.slots ?? []))
      .finally(() => setLoadingSlots(false));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSlot || !selectedDate || !name.trim() || !email.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/public/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, contact, date: selectedDate, time: selectedSlot, notes }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Something went wrong. Please try again.');
        if (res.status === 409) {
          setView('calendar');
          setSelectedSlot(null);
          fetch(`/api/public/availability?date=${selectedDate}`).then(r => r.json()).then(d => setSlots(d.slots ?? []));
        }
        return;
      }
      setConfirmedZoomLink(data.zoomLink || '');
      setView('confirmed');
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDow = new Date(year, month - 1, 1).getDay();
  const availSet = new Set(availableDays);

  const Sidebar = () => (
    <div className="w-full md:w-64 shrink-0 p-6 md:border-r border-gray-100 space-y-4">
      <Image src="/sedo-logo.png" alt="SEDO" width={160} height={160} className="object-contain -my-6" priority />
      <div>
        <p className="text-xs font-medium text-gray-400">SEDO Official</p>
        <h1 className="text-lg font-bold text-gray-900 mt-0.5">SEDO Discovery Call</h1>
        <p className="text-sm text-gray-500 mt-1">Discovery Call for Partner Dropshipper</p>
      </div>
      <div className="space-y-2.5 pt-2">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Clock size={15} className="text-gray-400" /> 1h
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Video size={15} className="text-gray-400" /> Video Call
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Globe size={15} className="text-gray-400" /> Philippines Time (GMT+8)
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex items-center justify-center p-4"
      style={{ background: '#f9fafb' }}>
      <div className="w-full max-w-4xl rounded-2xl shadow-xl overflow-hidden bg-white flex flex-col md:flex-row">
        <Sidebar />

        <div className="flex-1 p-6">
          {view === 'confirmed' ? (
            <div className="flex flex-col items-center justify-center h-full py-10 text-center space-y-3">
              <CheckCircle2 className="text-green-500" size={48} />
              <h2 className="text-lg font-bold text-gray-900">Booking Confirmed!</h2>
              <p className="text-sm text-gray-600">
                {selectedDate && formatDateLabel(selectedDate)} at {selectedSlot && formatSlotLabel(selectedSlot, use24h)}
              </p>
              {confirmedZoomLink && (
                <a href={confirmedZoomLink} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-50 border border-blue-100 text-blue-700 text-sm font-medium hover:bg-blue-100 transition-colors">
                  <Video size={15} /> Join Zoom Meeting
                </a>
              )}
              <p className="text-xs text-gray-400 mt-2">We'll reach out to {email} to confirm the meeting details.</p>
            </div>
          ) : view === 'form' ? (
            <form onSubmit={handleSubmit} className="space-y-4 max-w-sm">
              <button type="button" onClick={() => setView('calendar')}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 mb-1">
                <ArrowLeft size={12} /> Back
              </button>
              <div className="bg-orange-50 border border-orange-100 rounded-xl px-4 py-3 flex items-center gap-2 text-sm text-orange-700 font-medium">
                <Clock size={15} /> {selectedDate && formatDateLabel(selectedDate)} at {selectedSlot && formatSlotLabel(selectedSlot, use24h)}
              </div>

              {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}

              <div>
                <label className="form-label">Full Name *</label>
                <input className="form-input" value={name} onChange={e => setName(e.target.value)} required />
              </div>
              <div>
                <label className="form-label">Email *</label>
                <input type="email" className="form-input" value={email} onChange={e => setEmail(e.target.value)} required />
              </div>
              <div>
                <label className="form-label">Phone Number</label>
                <input className="form-input" value={contact} onChange={e => setContact(e.target.value)} placeholder="Optional" />
              </div>
              <div>
                <label className="form-label">Anything you'd like us to know?</label>
                <textarea className="form-input" rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" />
              </div>

              <button type="submit" disabled={submitting || !name.trim() || !email.trim()}
                className="btn-primary w-full justify-center disabled:opacity-50">
                {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
                {submitting ? 'Booking...' : 'Confirm Booking'}
              </button>
            </form>
          ) : (
            <div className="flex flex-col md:flex-row gap-6">
              {/* Month calendar */}
              <div className="flex-1">
                <div className="flex items-center justify-between mb-4">
                  <p className="font-semibold text-gray-900">{MONTH_NAMES[month - 1]} {year}</p>
                  <div className="flex items-center gap-1">
                    <button onClick={() => shiftMonth(-1)} disabled={isPastMonth}
                      className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 disabled:opacity-30 disabled:cursor-not-allowed">
                      <ChevronLeft size={16} />
                    </button>
                    <button onClick={() => shiftMonth(1)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-7 gap-1 text-center">
                  {DAY_LABELS.map(d => (
                    <div key={d} className="text-[10px] font-semibold text-gray-400 py-1">{d}</div>
                  ))}
                  {Array.from({ length: firstDow }).map((_, i) => <div key={`pad-${i}`} />)}
                  {Array.from({ length: daysInMonth }).map((_, i) => {
                    const day = i + 1;
                    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    const available = availSet.has(day);
                    const isSelected = selectedDate === dateStr;
                    return (
                      <button
                        key={day}
                        disabled={!available || loadingMonth}
                        onClick={() => selectDate(day)}
                        className={`aspect-square rounded-lg text-sm font-medium transition-colors ${
                          isSelected
                            ? 'bg-gray-900 text-white'
                            : available
                              ? 'bg-gray-100 text-gray-900 hover:bg-orange-100'
                              : 'text-gray-300 cursor-default'
                        }`}
                      >
                        {day}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Time slots */}
              {selectedDate && (
                <div className="w-full md:w-48 shrink-0 md:border-l border-gray-100 md:pl-6">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-semibold text-gray-900">
                      {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-PH', { weekday: 'short', day: 'numeric' })}
                    </p>
                    <div className="flex items-center bg-gray-100 rounded-md p-0.5 text-[10px] font-semibold">
                      <button onClick={() => setUse24h(false)} className={`px-1.5 py-0.5 rounded ${!use24h ? 'bg-white shadow-sm' : 'text-gray-400'}`}>12h</button>
                      <button onClick={() => setUse24h(true)} className={`px-1.5 py-0.5 rounded ${use24h ? 'bg-white shadow-sm' : 'text-gray-400'}`}>24h</button>
                    </div>
                  </div>
                  {loadingSlots ? (
                    <div className="flex justify-center py-6"><Loader2 className="animate-spin text-gray-300" size={20} /></div>
                  ) : slots.length === 0 ? (
                    <p className="text-xs text-gray-400 py-4">No slots left this day.</p>
                  ) : (
                    <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                      {slots.map(s => (
                        <button
                          key={s}
                          onClick={() => { setSelectedSlot(s); setView('form'); }}
                          className="w-full px-3 py-2 rounded-lg border border-orange-200 text-orange-600 bg-orange-50 hover:bg-orange-500 hover:text-white text-sm font-medium transition-colors"
                        >
                          {formatSlotLabel(s, use24h)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
