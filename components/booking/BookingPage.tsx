'use client';

import { useEffect, useState, useCallback } from 'react';
import Image from 'next/image';
import clsx from 'clsx';
import {
  Clock, Video, Globe, CheckCircle2, Loader2, ArrowLeft, ChevronLeft, ChevronRight,
  Check, Lock, Sparkles, CalendarPlus, Home,
} from 'lucide-react';
import { todayISO } from '@/lib/utils';

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAY_LABELS = ['SUN','MON','TUE','WED','THU','FRI','SAT'];

const DISCOVER_ITEMS = [
  'How the SEDO business model works',
  'How to start without managing inventory',
  'Fulfillment and partner support',
  'Recommended next steps based on your goals',
];

const STEPS = [
  { n: 1, label: 'Select Date' },
  { n: 2, label: 'Select Time' },
  { n: 3, label: 'Confirm Details' },
] as const;

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

// Client-side only — builds a "Add to Calendar" link, no backend involved.
function buildGoogleCalendarLink(date: string, time: string, zoomLink: string) {
  const start = new Date(`${date}T${time}:00+08:00`);
  const end = new Date(start.getTime() + 60 * 60000);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: 'SEDO Discovery Call',
    dates: `${fmt(start)}/${fmt(end)}`,
    details: zoomLink ? `Join Zoom Meeting: ${zoomLink}` : 'SEDO Discovery Call',
    location: zoomLink || 'Zoom',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

type View = 'calendar' | 'form' | 'confirmed';
type FieldMode = 'required' | 'optional' | 'hidden';
interface BookingFieldConfig {
  contact: FieldMode;
  experience: FieldMode;
  goal: FieldMode;
}
const DEFAULT_FIELD_CONFIG: BookingFieldConfig = { contact: 'required', experience: 'optional', goal: 'optional' };

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
  const [businessExperience, setBusinessExperience] = useState('');
  const [mainGoal, setMainGoal] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [confirmedZoomLink, setConfirmedZoomLink] = useState('');
  const [fieldConfig, setFieldConfig] = useState<BookingFieldConfig>(DEFAULT_FIELD_CONFIG);

  const fetchMonth = useCallback((y: number, m: number) => {
    setLoadingMonth(true);
    fetch(`/api/public/availability/month?year=${y}&month=${m}`)
      .then(r => r.json())
      .then(d => setAvailableDays(d.availableDays ?? []))
      .finally(() => setLoadingMonth(false));
  }, []);

  useEffect(() => { fetchMonth(year, month); }, [year, month, fetchMonth]);

  useEffect(() => {
    fetch('/api/public/booking-fields')
      .then(r => r.json())
      .then(d => setFieldConfig({
        contact: d.contact ?? 'required',
        experience: d.experience ?? 'optional',
        goal: d.goal ?? 'optional',
      }))
      .catch(() => {});
  }, []);

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

  const isFieldSatisfied = (mode: FieldMode, value: string) => mode !== 'required' || value.trim().length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSlot || !selectedDate || !name.trim() || !email.trim()) return;
    if (!isFieldSatisfied(fieldConfig.contact, contact)) return;
    if (!isFieldSatisfied(fieldConfig.experience, businessExperience)) return;
    if (!isFieldSatisfied(fieldConfig.goal, mainGoal)) return;
    setSubmitting(true);
    setError('');
    // Fold the two SEDO-specific prompts into the existing free-text `notes`
    // field so the backend/API contract (name, email, contact, date, time, notes)
    // stays completely unchanged.
    const combinedNotes = [
      businessExperience.trim() && `Business experience: ${businessExperience.trim()}`,
      mainGoal.trim() && `Main goal: ${mainGoal.trim()}`,
    ].filter(Boolean).join('\n');
    try {
      const res = await fetch('/api/public/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, contact, date: selectedDate, time: selectedSlot, notes: combinedNotes }),
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

  const currentStep = view === 'form' ? 3 : selectedDate ? 2 : 1;

  const Sidebar = () => (
    <div
      className="w-full md:w-[360px] shrink-0 relative overflow-hidden text-white p-6 sm:p-8 md:p-10"
      style={{ background: 'linear-gradient(160deg, #0F2747 0%, #0057B8 100%)' }}
    >
      <div className="pointer-events-none absolute -top-12 -right-12 w-48 h-48 rounded-full bg-white/5 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-16 -left-10 w-40 h-40 rounded-full bg-white/5 blur-2xl" />

      <div className="relative space-y-5">
        <div className="inline-flex bg-white rounded-2xl p-2.5 shadow-lg">
          <Image src="/sedo-logo.png" alt="SEDO" width={96} height={96} className="object-contain w-16 h-16 sm:w-20 sm:h-20" priority />
        </div>

        <div>
          <p className="text-[11px] font-semibold text-blue-200/80 uppercase tracking-wider">SEDO Official</p>
          <h1 className="text-xl md:text-2xl font-bold text-white mt-1 leading-snug">Book Your SEDO Discovery Call</h1>
          <p className="text-sm text-blue-100/80 mt-2 leading-relaxed">
            Explore how SEDO can help you launch and grow your ecommerce business through a guided system, product support, and fulfillment solutions.
          </p>
        </div>

        <div className="inline-flex items-center gap-1.5 bg-white/10 border border-white/10 rounded-full px-3 py-1.5 text-[11px] font-semibold text-white">
          <Sparkles size={12} /> Limited Discovery Call Slots
        </div>

        <div className="space-y-3 pt-1">
          {[
            { icon: Clock, text: '60-minute session' },
            { icon: Video, text: 'Live video call' },
            { icon: Globe, text: 'Philippines Time (GMT+8)' },
            { icon: CheckCircle2, text: 'Free consultation' },
          ].map(({ icon: Icon, text }) => (
            <div key={text} className="flex items-center gap-2.5 text-sm text-blue-50">
              <span className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
                <Icon size={14} />
              </span>
              {text}
            </div>
          ))}
        </div>

        <div className="pt-3 border-t border-white/10">
          <p className="text-xs font-semibold text-blue-100/90 uppercase tracking-wide mb-2.5">What You&apos;ll Discover</p>
          <ul className="space-y-2">
            {DISCOVER_ITEMS.map(item => (
              <li key={item} className="flex items-start gap-2 text-sm text-blue-50/90">
                <Check size={14} className="mt-0.5 text-[#16A36A] shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="pt-3 border-t border-white/10">
          <p className="text-xs text-blue-100/70 leading-relaxed">
            Choose a schedule that works for you. No payment is required to book.
          </p>
        </div>
      </div>
    </div>
  );

  const ProgressIndicator = () => (
    <div className="flex items-center justify-center gap-1.5 sm:gap-2 mb-8">
      {STEPS.map((s, i) => {
        const isDone = s.n < currentStep;
        const isActive = s.n === currentStep;
        return (
          <div key={s.n} className="flex items-center">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={clsx(
                  'w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold transition-colors',
                  isDone || isActive ? 'bg-[#0057B8] text-white' : 'bg-gray-100 text-gray-400',
                  isActive && 'ring-4 ring-[#EAF3FF]'
                )}
              >
                {isDone ? <Check size={14} /> : s.n}
              </div>
              <span className={clsx('text-[10px] sm:text-[11px] font-medium hidden sm:block', isActive || isDone ? 'text-[#0057B8]' : 'text-gray-400')}>
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={clsx('w-8 sm:w-14 h-0.5 mx-1.5 mb-4 sm:mb-4 rounded transition-colors', isDone ? 'bg-[#0057B8]' : 'bg-gray-200')} />
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div
      className="min-h-screen relative overflow-hidden flex items-center justify-center p-4 py-10"
      style={{ background: 'linear-gradient(180deg, #F5F7FA 0%, #EAF3FF 100%)' }}
    >
      <div className="pointer-events-none absolute -top-32 -left-32 w-96 h-96 rounded-full bg-[#0057B8]/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-[#0057B8]/10 blur-3xl" />

      <div className="relative w-full max-w-5xl rounded-3xl shadow-2xl shadow-[#0F2747]/10 border border-white overflow-hidden bg-white flex flex-col md:flex-row">
        <Sidebar />

        <div className="flex-1 p-6 sm:p-8 md:p-10 min-w-0">
          {view !== 'confirmed' && <ProgressIndicator />}

          {view === 'confirmed' ? (
            <div className="flex flex-col items-center text-center py-4 md:py-8 animate-fadeInUp">
              <div className="w-16 h-16 rounded-full bg-[#16A36A]/10 flex items-center justify-center mb-4">
                <CheckCircle2 className="text-[#16A36A]" size={34} />
              </div>
              <h2 className="text-xl font-bold text-[#0F2747]">Your Discovery Call is Confirmed</h2>
              <p className="text-sm text-gray-600 mt-2">
                {selectedDate && formatDateLabel(selectedDate)} at {selectedSlot && formatSlotLabel(selectedSlot, use24h)}
              </p>
              <p className="text-xs text-gray-400 mt-1">Philippines Time (GMT+8)</p>

              {confirmedZoomLink && (
                <a
                  href={confirmedZoomLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-5 inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-[#EAF3FF] border border-[#0057B8]/20 text-[#0057B8] text-sm font-semibold hover:bg-[#0057B8] hover:text-white transition-colors"
                >
                  <Video size={16} /> Join Zoom Meeting
                </a>
              )}

              <div className="mt-5 bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 max-w-sm">
                <p className="text-xs text-gray-500 leading-relaxed">
                  A confirmation email{confirmedZoomLink ? ' with your schedule and Zoom link' : ' with your schedule'} has been sent to{' '}
                  <span className="font-medium text-gray-700">{email}</span>.
                </p>
              </div>

              <p className="text-xs font-semibold text-[#0057B8] mt-4">Please join 5 minutes before your scheduled session.</p>

              <div className="flex flex-col sm:flex-row gap-2.5 mt-6 w-full sm:w-auto">
                <a
                  href={selectedDate && selectedSlot ? buildGoogleCalendarLink(selectedDate, selectedSlot, confirmedZoomLink) : '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-[#0057B8] text-white text-sm font-semibold hover:bg-[#004a9c] transition-colors shadow-md shadow-[#0057B8]/20"
                >
                  <CalendarPlus size={16} /> Add to Calendar
                </a>
                <a
                  href="/"
                  className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl border border-gray-200 text-gray-600 text-sm font-semibold hover:bg-gray-50 transition-colors"
                >
                  <Home size={16} /> Return to Home
                </a>
              </div>
            </div>
          ) : view === 'form' ? (
            <form onSubmit={handleSubmit} className="space-y-5 max-w-md mx-auto animate-fadeInUp">
              <button
                type="button"
                onClick={() => setView('calendar')}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-[#0057B8] transition-colors -ml-1"
              >
                <ArrowLeft size={13} /> Back to calendar
              </button>

              <div className="sticky top-2 z-10 bg-[#EAF3FF]/95 backdrop-blur-sm border border-[#0057B8]/15 rounded-2xl px-4 py-3.5 flex items-center gap-3">
                <span className="w-9 h-9 rounded-full bg-[#0057B8] text-white flex items-center justify-center shrink-0">
                  <Clock size={16} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[#0F2747] truncate">{selectedDate && formatDateLabel(selectedDate)}</p>
                  <p className="text-xs text-[#0057B8] font-medium">
                    {selectedSlot && formatSlotLabel(selectedSlot, use24h)} &middot; GMT+8
                  </p>
                </div>
              </div>

              {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>}

              <div>
                <label htmlFor="booking-name" className="block text-sm font-semibold text-[#0F2747] mb-1.5">Full Name *</label>
                <input
                  id="booking-name"
                  className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0057B8]/40 focus:border-[#0057B8] transition-colors"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Juan Dela Cruz"
                  required
                />
              </div>
              <div>
                <label htmlFor="booking-email" className="block text-sm font-semibold text-[#0F2747] mb-1.5">Email Address *</label>
                <input
                  id="booking-email"
                  type="email"
                  className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0057B8]/40 focus:border-[#0057B8] transition-colors"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@email.com"
                  required
                />
              </div>
              {fieldConfig.contact !== 'hidden' && (
                <div>
                  <label htmlFor="booking-contact" className="block text-sm font-semibold text-[#0F2747] mb-1.5">
                    Mobile Number{fieldConfig.contact === 'required' ? ' *' : ''}
                  </label>
                  <input
                    id="booking-contact"
                    className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0057B8]/40 focus:border-[#0057B8] transition-colors"
                    value={contact}
                    onChange={e => setContact(e.target.value)}
                    placeholder={fieldConfig.contact === 'required' ? '09XX XXX XXXX' : '09XX XXX XXXX (optional)'}
                    required={fieldConfig.contact === 'required'}
                  />
                </div>
              )}
              {fieldConfig.experience !== 'hidden' && (
                <div>
                  <label htmlFor="booking-experience" className="block text-sm font-semibold text-[#0F2747] mb-1.5">
                    Current Business / Experience{fieldConfig.experience === 'required' ? ' *' : ''}
                  </label>
                  <textarea
                    id="booking-experience"
                    className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0057B8]/40 focus:border-[#0057B8] transition-colors resize-none"
                    rows={2}
                    value={businessExperience}
                    onChange={e => setBusinessExperience(e.target.value)}
                    placeholder={fieldConfig.experience === 'required' ? 'e.g. New to ecommerce, or currently running a small online shop' : 'e.g. New to ecommerce, or currently running a small online shop (optional)'}
                    required={fieldConfig.experience === 'required'}
                  />
                </div>
              )}
              {fieldConfig.goal !== 'hidden' && (
                <div>
                  <label htmlFor="booking-goal" className="block text-sm font-semibold text-[#0F2747] mb-1.5">
                    Main Goal for Joining{fieldConfig.goal === 'required' ? ' *' : ''}
                  </label>
                  <textarea
                    id="booking-goal"
                    className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0057B8]/40 focus:border-[#0057B8] transition-colors resize-none"
                    rows={2}
                    value={mainGoal}
                    onChange={e => setMainGoal(e.target.value)}
                    placeholder={fieldConfig.goal === 'required' ? 'What are you hoping to achieve from this call?' : 'What are you hoping to achieve from this call? (optional)'}
                    required={fieldConfig.goal === 'required'}
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={
                  submitting || !name.trim() || !email.trim() ||
                  !isFieldSatisfied(fieldConfig.contact, contact) ||
                  !isFieldSatisfied(fieldConfig.experience, businessExperience) ||
                  !isFieldSatisfied(fieldConfig.goal, mainGoal)
                }
                className="w-full inline-flex items-center justify-center gap-2 bg-[#0057B8] text-white text-sm font-bold rounded-xl px-6 py-3.5 hover:bg-[#004a9c] transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-[#0057B8]/25"
              >
                {submitting ? <Loader2 size={16} className="animate-spin" /> : null}
                {submitting ? 'Booking your call...' : 'Confirm My Discovery Call'}
              </button>
              <p className="flex items-center justify-center gap-1.5 text-[11px] text-gray-400 text-center">
                <Lock size={11} /> Your information is secure and will only be used for your scheduled session.
              </p>
            </form>
          ) : (
            <div className="max-w-2xl mx-auto">
              <div className="flex items-center justify-between mb-1">
                <div>
                  <h2 className="text-lg font-bold text-[#0F2747]">{MONTH_NAMES[month - 1]} {year}</h2>
                  <p className="text-xs text-gray-500 mt-0.5">Select an available date</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label="Previous month"
                    onClick={() => shiftMonth(-1)}
                    disabled={isPastMonth}
                    className="w-10 h-10 rounded-full border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-[#EAF3FF] hover:text-[#0057B8] hover:border-[#0057B8]/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0057B8]"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    type="button"
                    aria-label="Next month"
                    onClick={() => shiftMonth(1)}
                    className="w-10 h-10 rounded-full border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-[#EAF3FF] hover:text-[#0057B8] hover:border-[#0057B8]/30 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0057B8]"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-7 gap-1.5 sm:gap-2 text-center mt-5">
                {DAY_LABELS.map(d => (
                  <div key={d} className="text-[10px] font-semibold text-gray-400 py-1">{d}</div>
                ))}
                {Array.from({ length: firstDow }).map((_, i) => <div key={`pad-${i}`} />)}
                {Array.from({ length: daysInMonth }).map((_, i) => {
                  const day = i + 1;
                  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                  const available = availSet.has(day);
                  const isSelected = selectedDate === dateStr;
                  const isToday = dateStr === today;
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-label={`${MONTH_NAMES[month - 1]} ${day}, ${year}${isSelected ? ', selected' : available ? ', available' : ', unavailable'}`}
                      aria-pressed={isSelected}
                      disabled={!available || loadingMonth}
                      onClick={() => selectDate(day)}
                      className={clsx(
                        'relative aspect-square rounded-xl text-sm font-semibold transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0057B8] focus-visible:ring-offset-1',
                        isSelected
                          ? 'bg-[#0057B8] text-white shadow-md shadow-[#0057B8]/30'
                          : available
                            ? 'bg-white text-[#0F2747] border border-[#0057B8]/20 hover:border-[#0057B8]/50 hover:-translate-y-0.5 hover:shadow-md cursor-pointer'
                            : 'text-gray-300 border border-transparent cursor-not-allowed',
                        isToday && !isSelected && 'ring-1 ring-offset-1 ring-[#0057B8]/40'
                      )}
                    >
                      {day}
                      {isSelected && <Check size={10} className="absolute top-1 right-1 text-white/90" />}
                      {available && !isSelected && (
                        <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-[#0057B8]" />
                      )}
                    </button>
                  );
                })}
              </div>

              {selectedDate && (
                <div className="mt-8 pt-6 border-t border-gray-100 animate-fadeInUp">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h3 className="text-sm font-bold text-[#0F2747]">Available Times</h3>
                      <p className="text-xs text-gray-500 mt-0.5">{formatDateLabel(selectedDate)}</p>
                    </div>
                    <div className="flex items-center bg-gray-100 rounded-lg p-0.5 text-[10px] font-semibold">
                      <button
                        type="button"
                        aria-pressed={!use24h}
                        onClick={() => setUse24h(false)}
                        className={clsx('px-2 py-1 rounded', !use24h ? 'bg-white shadow-sm text-[#0057B8]' : 'text-gray-400')}
                      >
                        12h
                      </button>
                      <button
                        type="button"
                        aria-pressed={use24h}
                        onClick={() => setUse24h(true)}
                        className={clsx('px-2 py-1 rounded', use24h ? 'bg-white shadow-sm text-[#0057B8]' : 'text-gray-400')}
                      >
                        24h
                      </button>
                    </div>
                  </div>
                  {loadingSlots ? (
                    <div className="flex justify-center py-8"><Loader2 className="animate-spin text-gray-300" size={22} /></div>
                  ) : slots.length === 0 ? (
                    <p className="text-sm text-gray-400 py-6 text-center bg-gray-50 rounded-xl">No slots left this day. Please choose another date.</p>
                  ) : (
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {slots.map(s => {
                        const isSel = selectedSlot === s;
                        return (
                          <button
                            key={s}
                            type="button"
                            aria-label={`Select time ${formatSlotLabel(s, use24h)}`}
                            aria-pressed={isSel}
                            onClick={() => { setSelectedSlot(s); setView('form'); }}
                            className={clsx(
                              'px-3 py-2.5 rounded-xl border text-sm font-semibold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0057B8]',
                              isSel
                                ? 'bg-[#0057B8] border-[#0057B8] text-white shadow-md'
                                : 'bg-[#EAF3FF]/60 border-[#0057B8]/15 text-[#0057B8] hover:bg-[#0057B8] hover:text-white hover:border-[#0057B8]'
                            )}
                          >
                            {formatSlotLabel(s, use24h)}
                          </button>
                        );
                      })}
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
