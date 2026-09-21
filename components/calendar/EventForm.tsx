'use client';

import { useMemo, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { CATEGORIES, CATEGORY_BY_KEY, REMINDER_PRESETS, reminderLabel } from '@/lib/calendar';
import { describeRule, normalizeRule } from '@/lib/calendar-recurrence';
import { PAYMENT_METHODS, type CalEvent, type Meta } from './calendar-ui';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
type Repeat = 'none' | 'daily' | 'weekly' | 'weekdays' | 'monthly' | 'yearly' | 'custom';

interface Form {
  event_title: string; category: string; business_unit_id: string; assigned_user_id: string;
  start_date: string; end_date: string; multiDay: boolean; start_time: string; end_time: string; all_day: boolean; description: string; privacy: string;
  amount: string; payee: string; payment_method: string; reference_no: string; account_bank: string; other_financial: string;
  meeting_location: string; meeting_link: string; attendeeUsers: number[]; guests: { name: string; email: string }[];
  reminders: number[]; customReminder: string; sync_google: boolean; google_meet: boolean;
  repeat: Repeat; unit: 'day' | 'week' | 'month' | 'year'; interval: string; weekdays: number[]; monthdays: string; endType: 'never' | 'until' | 'count'; until: string; count: string;
}

const fresh = (meta: Meta, date: string): Form => ({
  event_title: '', category: 'meeting', business_unit_id: '', assigned_user_id: '', start_date: date, end_date: date, multiDay: false, start_time: '09:00', end_time: '10:00', all_day: false,
  description: '', privacy: 'public', amount: '', payee: '', payment_method: '', reference_no: '', account_bank: '', other_financial: 'NONE',
  meeting_location: '', meeting_link: '', attendeeUsers: [], guests: [], reminders: [], customReminder: '', sync_google: true, google_meet: false,
  repeat: 'none', unit: 'week', interval: '1', weekdays: [], monthdays: '', endType: 'never', until: '', count: '10',
});

function fromEvent(e: CalEvent): Form {
  return {
    ...fresh({} as Meta, e.start_date),
    event_title: e.event_title, category: e.category, business_unit_id: e.business_unit_id ? String(e.business_unit_id) : '', assigned_user_id: e.assigned_user_id ? String(e.assigned_user_id) : '',
    start_date: e.start_date, end_date: e.end_date, multiDay: e.end_date !== e.start_date, start_time: e.start_time ?? '09:00', end_time: e.end_time ?? '10:00', all_day: !!e.all_day,
    description: e.description ?? '', privacy: e.privacy, amount: e.amount != null ? String(e.amount) : '', payee: e.payee ?? '', payment_method: e.payment_method ?? '', reference_no: e.reference_no ?? '',
    account_bank: e.account_bank ?? '', other_financial: e.financial_type, meeting_location: e.meeting_location ?? '', meeting_link: e.meeting_link ?? '',
    attendeeUsers: (e.attendees ?? []).filter(a => a.user_id).map(a => a.user_id as number), guests: (e.attendees ?? []).filter(a => !a.user_id).map(a => ({ name: a.name, email: a.email ?? '' })),
    reminders: e.reminders ?? [], sync_google: e.sync_google !== 0, google_meet: !!e.google_meet,
  };
}

// Add / Edit a schedule. Payment fields appear only for payment / collection categories,
// meeting fields only for meetings; the server re-checks everything.
export default function EventForm({ meta, initialDate, event, onClose, onSaved }: { meta: Meta; initialDate: string; event?: CalEvent | null; onClose: () => void; onSaved: (id?: number) => void }) {
  const editing = !!event;
  const [f, setF] = useState<Form>(() => (event ? fromEvent(event) : (() => { const x = fresh(meta, initialDate); return x; })()));
  const [scope, setScope] = useState<'this' | 'future' | 'all'>('this');
  const [changeRepeat, setChangeRepeat] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (p: Partial<Form>) => setF(s => ({ ...s, ...p }));

  const cat = CATEGORY_BY_KEY[f.category];
  const financial = f.category === 'other' ? f.other_financial : cat?.financial ?? 'NONE';
  const isFinancial = financial !== 'NONE';
  const isMeeting = f.category === 'meeting';
  const recurring = !!event?.recurrence_id;
  const showRepeat = !editing || (recurring && scope !== 'this');
  const repeatEditable = !editing || changeRepeat;

  const onCategory = (key: string) => {
    const next = CATEGORY_BY_KEY[key];
    // A payment / collection starts with the usual reminders (1 day before + the day itself).
    const reminders = !editing && next?.financial !== 'NONE' && f.reminders.length === 0 ? [1, 0] : f.reminders;
    // A new meeting starts as a timed event; payments and deadlines are all-day.
    set({ category: key, reminders, all_day: !editing ? key !== 'meeting' : f.all_day, privacy: !editing ? (next?.financial !== 'NONE' ? 'restricted' : 'public') : f.privacy });
  };

  const ruleBody = useMemo(() => {
    if (f.repeat === 'none') return null;
    const md = f.monthdays.split(/[\s,;]+/).filter(Boolean).map(Number);
    return {
      freq: f.repeat, unit: f.repeat === 'custom' ? f.unit : undefined, interval: Number(f.interval) || 1, by_weekday: f.weekdays, by_monthday: md,
      end_type: f.endType, until: f.endType === 'until' ? f.until : null, count: f.endType === 'count' ? Number(f.count) : null,
    };
  }, [f.repeat, f.unit, f.interval, f.weekdays, f.monthdays, f.endType, f.until, f.count]);
  const repeatText = useMemo(() => {
    if (!ruleBody) return '';
    const r = normalizeRule(ruleBody as any, f.start_date);
    return 'error' in r ? r.error : describeRule(r.rule);
  }, [ruleBody, f.start_date]);

  const toggleReminder = (d: number) => set({ reminders: f.reminders.includes(d) ? f.reminders.filter(x => x !== d) : [...f.reminders, d].sort((a, b) => b - a) });
  const addCustomReminder = () => {
    const n = Number(f.customReminder);
    if (Number.isInteger(n) && n >= 0 && n <= 365 && !f.reminders.includes(n)) set({ reminders: [...f.reminders, n].sort((a, b) => b - a), customReminder: '' });
  };

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const body: any = {
        event_title: f.event_title, category: f.category, business_unit_id: f.business_unit_id ? Number(f.business_unit_id) : null, assigned_user_id: f.assigned_user_id ? Number(f.assigned_user_id) : null,
        start_date: f.start_date, end_date: f.multiDay ? f.end_date : f.start_date, all_day: f.all_day, start_time: f.all_day ? null : f.start_time, end_time: f.all_day ? null : (f.end_time || null),
        description: f.description, privacy: f.privacy, reminders: f.reminders,
        sync_google: f.sync_google, google_meet: isMeeting && f.google_meet,
      };
      if (f.category === 'other') body.financial_type = f.other_financial;
      if (isFinancial) Object.assign(body, { amount: f.amount === '' ? null : Number(f.amount), payee: f.payee, payment_method: f.payment_method, reference_no: f.reference_no, account_bank: f.account_bank });
      if (isMeeting) Object.assign(body, {
        meeting_location: f.meeting_location, meeting_link: f.meeting_link,
        attendees: [...f.attendeeUsers.map(id => ({ user_id: id })), ...f.guests.filter(g => g.name.trim()).map(g => ({ name: g.name, email: g.email || null }))],
      });
      if (!editing) body.recurrence = ruleBody;
      else if (recurring && scope !== 'this' && changeRepeat) body.recurrence = ruleBody ?? undefined;
      if (editing) body.scope = recurring ? scope : 'this';
      const res = await fetch(editing ? `/api/calendar/events/${event!.id}` : '/api/calendar/events', { method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await res.json();
      if (!res.ok) { setError(d.error || 'Could not save.'); return; }
      onSaved(d.id ?? event?.id);
    } finally {
      setBusy(false);
    }
  };

  const label = 'form-label';
  return (
    <Modal open onClose={() => !busy && onClose()} title={editing ? 'Edit Schedule' : 'Add Schedule'} size="lg">
      <div className="space-y-5">
        {/* Basic information */}
        <div className="space-y-3">
          <div>
            <label className={label} htmlFor="ev-title">Event Title *</label>
            <input id="ev-title" className="form-input" value={f.event_title} maxLength={200} onChange={e => set({ event_title: e.target.value })} placeholder="e.g. Cesar Residences Rent" autoFocus />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={label} htmlFor="ev-cat">Category *</label>
              <select id="ev-cat" className="form-input" value={f.category} onChange={e => onCategory(e.target.value)}>
                {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className={label} htmlFor="ev-unit">Business Unit</label>
              <select id="ev-unit" className="form-input" value={f.business_unit_id} onChange={e => set({ business_unit_id: e.target.value })}>
                <option value="">— None —</option>{meta.business_units.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          </div>
          {f.category === 'other' && !editing && (
            <div>
              <label className={label} htmlFor="ev-ftype">This schedule is</label>
              <select id="ev-ftype" className="form-input" value={f.other_financial} onChange={e => set({ other_financial: e.target.value })}>
                <option value="NONE">Not about money</option><option value="PAYMENT">A payment to make</option><option value="COLLECTION">A collection to receive</option>
              </select>
            </div>
          )}
          <div>
            <label className={label} htmlFor="ev-assign">Assigned To</label>
            <select id="ev-assign" className="form-input" value={f.assigned_user_id} onChange={e => set({ assigned_user_id: e.target.value })}>
              <option value="">— Nobody —</option>{meta.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>

        {/* When */}
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={label} htmlFor="ev-date">{isFinancial ? 'Due Date *' : 'Date *'}</label>
              <input id="ev-date" type="date" className="form-input" value={f.start_date} onChange={e => set({ start_date: e.target.value, end_date: f.multiDay && f.end_date >= e.target.value ? f.end_date : e.target.value })} />
            </div>
            {f.multiDay && (
              <div>
                <label className={label} htmlFor="ev-end-date">End Date</label>
                <input id="ev-end-date" type="date" className="form-input" min={f.start_date} value={f.end_date} onChange={e => set({ end_date: e.target.value })} />
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-gray-700">
            <label className="inline-flex items-center gap-2"><input type="checkbox" checked={f.all_day} onChange={e => set({ all_day: e.target.checked })} /> All Day</label>
            <label className="inline-flex items-center gap-2"><input type="checkbox" checked={f.multiDay} onChange={e => set({ multiDay: e.target.checked, end_date: e.target.checked ? f.end_date : f.start_date })} /> Multi-day</label>
          </div>
          {!f.all_day && (
            <div className="grid grid-cols-2 gap-3">
              <div><label className={label} htmlFor="ev-st">Start Time</label><input id="ev-st" type="time" className="form-input" value={f.start_time} onChange={e => set({ start_time: e.target.value })} /></div>
              <div><label className={label} htmlFor="ev-et">End Time</label><input id="ev-et" type="time" className="form-input" value={f.end_time} onChange={e => set({ end_time: e.target.value })} /></div>
            </div>
          )}
        </div>

        {/* Payment / collection */}
        {isFinancial && (
          <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3.5 space-y-3" data-testid="financial-fields">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{financial === 'COLLECTION' ? 'Collection details' : 'Payment details'}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><label className={label} htmlFor="ev-amt">Amount (₱) *</label><input id="ev-amt" type="number" min="0" step="0.01" className="form-input" value={f.amount} onChange={e => set({ amount: e.target.value })} /></div>
              <div><label className={label} htmlFor="ev-payee">{financial === 'COLLECTION' ? 'Payer / Source' : 'Payee / Supplier / Recipient'}</label><input id="ev-payee" className="form-input" value={f.payee} onChange={e => set({ payee: e.target.value })} /></div>
              <div><label className={label} htmlFor="ev-pm">Payment Method</label>
                <select id="ev-pm" className="form-input" value={f.payment_method} onChange={e => set({ payment_method: e.target.value })}><option value="">—</option>{PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}</select></div>
              <div><label className={label} htmlFor="ev-ref">Reference Number</label><input id="ev-ref" className="form-input" value={f.reference_no} onChange={e => set({ reference_no: e.target.value })} /></div>
              <div className="sm:col-span-2"><label className={label} htmlFor="ev-bank">Account / Bank</label><input id="ev-bank" className="form-input" value={f.account_bank} onChange={e => set({ account_bank: e.target.value })} /></div>
            </div>
            <p className="text-xs text-gray-400">Status starts as {financial === 'COLLECTION' ? 'Expected' : 'Upcoming'} and updates by itself as payments are recorded and the due date passes.</p>
          </div>
        )}

        {/* Meeting */}
        {isMeeting && (
          <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3.5 space-y-3" data-testid="meeting-fields">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Meeting</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><label className={label} htmlFor="ev-loc">Meeting Location</label><input id="ev-loc" className="form-input" value={f.meeting_location} onChange={e => set({ meeting_location: e.target.value })} /></div>
              <div><label className={label} htmlFor="ev-link">Meeting Link</label><input id="ev-link" className="form-input" placeholder="https://" value={f.meeting_link} onChange={e => set({ meeting_link: e.target.value })} /></div>
            </div>
            <div>
              <p className={label}>Attendees</p>
              <div className="flex flex-wrap gap-1.5">
                {meta.people.map(p => (
                  <button type="button" key={p.id} onClick={() => set({ attendeeUsers: f.attendeeUsers.includes(p.id) ? f.attendeeUsers.filter(x => x !== p.id) : [...f.attendeeUsers, p.id] })} aria-pressed={f.attendeeUsers.includes(p.id)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border ${f.attendeeUsers.includes(p.id) ? 'bg-orange-50 border-orange-300 text-orange-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>{p.name}</button>
                ))}
              </div>
              {f.guests.map((g, i) => (
                <div key={i} className="flex gap-2 mt-2">
                  <input className="form-input" placeholder="Guest name" value={g.name} onChange={e => set({ guests: f.guests.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                  <input className="form-input" placeholder="Email (optional)" value={g.email} onChange={e => set({ guests: f.guests.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)) })} />
                  <button type="button" aria-label="Remove guest" onClick={() => set({ guests: f.guests.filter((_, j) => j !== i) })} className="p-2 text-gray-400 hover:text-red-500"><X size={16} /></button>
                </div>
              ))}
              <button type="button" onClick={() => set({ guests: [...f.guests, { name: '', email: '' }] })} className="text-xs font-medium text-orange-600 hover:text-orange-800 mt-2">+ Add someone outside the company</button>
            </div>
          </div>
        )}

        <div>
          <label className={label} htmlFor="ev-desc">Description / Notes</label>
          <textarea id="ev-desc" className="form-input" rows={3} value={f.description} onChange={e => set({ description: e.target.value })} />
        </div>

        {/* Repeat */}
        {editing && recurring && (
          <div className="rounded-lg bg-blue-50 border border-blue-200 px-3.5 py-3 text-sm text-blue-900 space-y-2">
            <p className="font-medium">This is part of a repeating schedule{event?.recurrence_text ? ` (${event.recurrence_text})` : ''}. Apply changes to:</p>
            {([['this', 'This schedule only'], ['future', 'This and following schedules'], ['all', 'All schedules in the series']] as const).map(([k, l]) => (
              <label key={k} className="flex items-center gap-2"><input type="radio" name="scope" checked={scope === k} onChange={() => setScope(k)} /> {l}</label>
            ))}
            <p className="text-xs text-blue-700">Occurrences that already have payments keep their own amount and date.</p>
          </div>
        )}
        {showRepeat && (
          <div className="space-y-3">
            {editing && recurring && scope !== 'this' && (
              <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={changeRepeat} onChange={e => setChangeRepeat(e.target.checked)} /> Change how it repeats</label>
            )}
            {repeatEditable && (
              <>
                <div>
                  <label className={label} htmlFor="ev-repeat">Repeat</label>
                  <select id="ev-repeat" className="form-input" value={f.repeat} onChange={e => set({ repeat: e.target.value as Repeat })}>
                    <option value="none">Does Not Repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="weekdays">Every Weekday</option>
                    <option value="monthly">Monthly</option><option value="yearly">Yearly</option><option value="custom">Custom…</option>
                  </select>
                </div>
                {f.repeat !== 'none' && (
                  <div className="rounded-xl border border-gray-100 p-3.5 space-y-3">
                    {(f.repeat === 'custom' || f.repeat === 'daily' || f.repeat === 'weekly' || f.repeat === 'monthly' || f.repeat === 'yearly') && (
                      <div className="flex flex-wrap items-center gap-2 text-sm text-gray-700">
                        <span>Every</span>
                        <input aria-label="Repeat every" type="number" min="1" max="365" className="form-input w-20" value={f.interval} onChange={e => set({ interval: e.target.value })} />
                        {f.repeat === 'custom'
                          ? <select aria-label="Repeat unit" className="form-input w-auto" value={f.unit} onChange={e => set({ unit: e.target.value as any })}><option value="day">days</option><option value="week">weeks</option><option value="month">months</option><option value="year">years</option></select>
                          : <span>{({ daily: 'day(s)', weekly: 'week(s)', monthly: 'month(s)', yearly: 'year(s)' } as any)[f.repeat]}</span>}
                      </div>
                    )}
                    {(f.repeat === 'weekly' || (f.repeat === 'custom' && f.unit === 'week')) && (
                      <div>
                        <p className="text-xs text-gray-500 mb-1">On</p>
                        <div className="flex flex-wrap gap-1.5">
                          {WEEKDAYS.map((w, i) => (
                            <button type="button" key={w} aria-pressed={f.weekdays.includes(i)} onClick={() => set({ weekdays: f.weekdays.includes(i) ? f.weekdays.filter(x => x !== i) : [...f.weekdays, i] })}
                              className={`w-11 py-1.5 rounded-lg text-xs font-semibold border ${f.weekdays.includes(i) ? 'bg-orange-50 border-orange-300 text-orange-700' : 'bg-white border-gray-200 text-gray-600'}`}>{w}</button>
                          ))}
                        </div>
                        <p className="text-[11px] text-gray-400 mt-1">Leave empty to use the weekday of the date.</p>
                      </div>
                    )}
                    {(f.repeat === 'monthly' || (f.repeat === 'custom' && f.unit === 'month')) && (
                      <div>
                        <label className="text-xs text-gray-500" htmlFor="ev-md">On these days of the month</label>
                        <input id="ev-md" className="form-input mt-1" placeholder="e.g. 8, 15, 23, 30 — blank = same day as the date" value={f.monthdays} onChange={e => set({ monthdays: e.target.value })} />
                        <p className="text-[11px] text-gray-400 mt-1">A day a short month does not have (30th in February) falls on that month&apos;s last day.</p>
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-2 text-sm text-gray-700">
                      <span>Ends</span>
                      <select aria-label="Repeat ends" className="form-input w-auto" value={f.endType} onChange={e => set({ endType: e.target.value as any })}><option value="never">Never</option><option value="until">On a date</option><option value="count">After a number of times</option></select>
                      {f.endType === 'until' && <input aria-label="Repeat until" type="date" className="form-input w-auto" min={f.start_date} value={f.until} onChange={e => set({ until: e.target.value })} />}
                      {f.endType === 'count' && <input aria-label="Repeat count" type="number" min="1" className="form-input w-24" value={f.count} onChange={e => set({ count: e.target.value })} />}
                    </div>
                    <p className="text-sm font-medium text-gray-800" data-testid="repeat-summary">{repeatText}</p>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Reminders */}
        <div>
          <p className={label}>Reminders</p>
          <div className="flex flex-wrap gap-1.5">
            {REMINDER_PRESETS.map(p => (
              <button type="button" key={p.days} aria-pressed={f.reminders.includes(p.days)} onClick={() => toggleReminder(p.days)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border ${f.reminders.includes(p.days) ? 'bg-orange-50 border-orange-300 text-orange-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>{p.label}</button>
            ))}
            {f.reminders.filter(d => !REMINDER_PRESETS.some(p => p.days === d)).map(d => (
              <button type="button" key={d} onClick={() => toggleReminder(d)} aria-pressed className="px-2.5 py-1.5 rounded-lg text-xs font-medium border bg-orange-50 border-orange-300 text-orange-700">{reminderLabel(d)} ✕</button>
            ))}
            <span className="inline-flex items-center gap-1">
              <input aria-label="Custom reminder days" type="number" min="0" max="365" className="form-input w-20 py-1.5" placeholder="days" value={f.customReminder} onChange={e => set({ customReminder: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomReminder(); } }} />
              <button type="button" onClick={addCustomReminder} className="text-xs font-medium text-orange-600 hover:text-orange-800 px-1">+ Custom</button>
            </span>
          </div>
          <p className="text-[11px] text-gray-400 mt-1">You and the people involved are alerted inside RPJ System on those days.</p>
        </div>

        {meta.google?.available && (
          <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3.5 space-y-2" data-testid="google-options">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Google Calendar</p>
            <label className="flex items-start gap-2 text-sm text-gray-700"><input type="checkbox" className="mt-0.5" checked={f.sync_google} onChange={e => set({ sync_google: e.target.checked })} />
              <span>Show in Google Calendar<span className="block text-xs text-gray-400">{isFinancial ? 'Only the basic headline is sent (e.g. “RPJ – Supplier Payment Due”) unless the Owner turned on details.' : 'Sent with its title, time and place.'}</span></span></label>
            {isMeeting && f.sync_google && (
              <label className="flex items-start gap-2 text-sm text-gray-700"><input type="checkbox" className="mt-0.5" checked={f.google_meet} onChange={e => set({ google_meet: e.target.checked })} />
                <span>Create a Google Meet link<span className="block text-xs text-gray-400">The link appears here shortly after saving.</span></span></label>
            )}
          </div>
        )}

        <div>
          <label className={label} htmlFor="ev-priv">Privacy</label>
          <select id="ev-priv" className="form-input" value={f.privacy} onChange={e => set({ privacy: e.target.value })}>
            <option value="public">Public to Company</option><option value="restricted">Restricted — only people involved, Finance and Owner</option><option value="private">Private — others only see “Private Schedule”</option>
          </select>
        </div>

        {error && <p className="text-sm text-red-600 font-medium" role="alert">{error}</p>}
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 [&>button]:justify-center">
          <button onClick={onClose} disabled={busy} className="btn-secondary">Cancel</button>
          <button onClick={save} disabled={busy} className="btn-primary disabled:opacity-50">{busy ? <Loader2 size={14} className="animate-spin" /> : null}{editing ? 'Save Changes' : 'Save Schedule'}</button>
        </div>
      </div>
    </Modal>
  );
}
