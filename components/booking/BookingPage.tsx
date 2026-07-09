'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { CalendarDays, Clock, CheckCircle2, Loader2, ArrowLeft } from 'lucide-react';
import { todayISO } from '@/lib/utils';

function formatSlotLabel(time: string) {
  const [h, m] = time.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function formatDateLabel(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-PH', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

export default function BookingPage() {
  const [date, setDate] = useState(todayISO());
  const [slots, setSlots] = useState<string[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(true);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [contact, setContact] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    setLoadingSlots(true);
    setSelectedSlot(null);
    fetch(`/api/public/availability?date=${date}`)
      .then(r => r.json())
      .then(d => setSlots(d.slots ?? []))
      .finally(() => setLoadingSlots(false));
  }, [date]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSlot || !name.trim() || !email.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/public/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, contact, date, time: selectedSlot, notes }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Something went wrong. Please try again.');
        if (res.status === 409) {
          setSelectedSlot(null);
          fetch(`/api/public/availability?date=${date}`).then(r => r.json()).then(d => setSlots(d.slots ?? []));
        }
        return;
      }
      setConfirmed(true);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      style={{ background: 'linear-gradient(160deg, #dce8f5 0%, #e8f2fb 50%, #d4e4f5 100%)' }}>
      <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full blur-3xl opacity-40"
        style={{ background: 'radial-gradient(circle, #bfdbfe, transparent)' }} />
      <div className="absolute -bottom-24 -right-24 w-96 h-96 rounded-full blur-3xl opacity-40"
        style={{ background: 'radial-gradient(circle, #c7d2fe, transparent)' }} />

      <div className="relative w-full max-w-lg rounded-3xl shadow-xl overflow-hidden"
        style={{ background: 'linear-gradient(180deg, #f8f9ff 0%, #ffffff 100%)' }}>
        <div className="px-8 pt-8 pb-6 text-center border-b border-gray-100">
          <Image src="/logo.png" alt="RPJ Corp" width={110} height={55} className="object-contain mx-auto mb-3" priority />
          <h1 className="text-xl font-bold text-gray-900">SEDO Discovery Call</h1>
          <p className="text-sm text-gray-500 mt-1">60-minute call — free consultation for partner dropshippers</p>
        </div>

        <div className="p-8">
          {confirmed ? (
            <div className="text-center py-6 space-y-3">
              <CheckCircle2 className="mx-auto text-green-500" size={48} />
              <h2 className="text-lg font-bold text-gray-900">Booking Confirmed!</h2>
              <p className="text-sm text-gray-600">
                {formatDateLabel(date)} at {formatSlotLabel(selectedSlot!)}
              </p>
              <p className="text-xs text-gray-400 mt-2">We'll reach out to {email} to confirm the meeting details.</p>
            </div>
          ) : selectedSlot ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <button type="button" onClick={() => setSelectedSlot(null)}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 mb-1">
                <ArrowLeft size={12} /> Back to time slots
              </button>
              <div className="bg-orange-50 border border-orange-100 rounded-xl px-4 py-3 flex items-center gap-2 text-sm text-orange-700 font-medium">
                <Clock size={15} /> {formatDateLabel(date)} at {formatSlotLabel(selectedSlot)}
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
            <div className="space-y-4">
              <div>
                <label className="form-label flex items-center gap-1.5"><CalendarDays size={14} /> Select a Date</label>
                <input
                  type="date"
                  className="form-input"
                  value={date}
                  min={todayISO()}
                  onChange={e => e.target.value && setDate(e.target.value)}
                />
              </div>

              <div>
                <p className="form-label mb-2 flex items-center gap-1.5"><Clock size={14} /> Available Times</p>
                {loadingSlots ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="animate-spin text-gray-300" size={24} />
                  </div>
                ) : slots.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-8">No available slots on this date. Please pick another date.</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {slots.map(s => (
                      <button
                        key={s}
                        onClick={() => setSelectedSlot(s)}
                        className="px-2 py-2 rounded-lg border border-orange-200 text-orange-600 bg-orange-50 hover:bg-orange-500 hover:text-white text-sm font-medium transition-colors"
                      >
                        {formatSlotLabel(s)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
