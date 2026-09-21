'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Filter, Loader2, Plus, Search, X } from 'lucide-react';
import { Toast, useToast } from '@/components/ui/Toast';
import { STATUS_LABEL, addDays, addMonthsYM, monthBounds, startOfWeek } from '@/lib/calendar';
import EventForm from './EventForm';
import EventDetail from './EventDetail';
import PaymentDialog from './PaymentDialog';
import GoogleSyncPanel from './GoogleSyncPanel';
import { AgendaView, DayView, EventRow, MonthView, WeekView, eventsOn } from './CalendarViews';
import { NotificationBell, OverdueBanner, SummaryCards, TodayWidget, WeekWidget, type Summary, type Upcoming } from './CalendarWidgets';
import { catLabel, longDate, niceDate, type CalEvent, type Meta } from './calendar-ui';

type View = 'month' | 'week' | 'day' | 'agenda';
interface Filters { q: string; business_unit_id: string; category: string; status: string; assigned_to: string; financial_only: boolean; meetings_only: boolean; overdue_only: boolean }
const NO_FILTERS: Filters = { q: '', business_unit_id: '', category: '', status: '', assigned_to: '', financial_only: false, meetings_only: false, overdue_only: false };
const STATUS_OPTIONS = ['upcoming', 'due_today', 'overdue', 'partially_paid', 'paid', 'expected', 'partial', 'received', 'delayed', 'scheduled', 'completed', 'cancelled'];

const monthTitle = (ym: string) => niceDate(`${ym}-01`, { month: 'long', year: 'numeric' });

// Range of dates to load for what is on screen.
function rangeFor(view: View, cursor: string): { from: string; to: string } {
  if (view === 'month') { const b = monthBounds(cursor.slice(0, 7)); return { from: startOfWeek(b.from), to: addDays(startOfWeek(b.to), 6) }; }
  if (view === 'week') { const s = startOfWeek(cursor); return { from: s, to: addDays(s, 6) }; }
  if (view === 'day') return { from: cursor, to: cursor };
  return monthBounds(cursor.slice(0, 7));
}

export default function CalendarClient() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [metaError, setMetaError] = useState('');
  const [view, setView] = useState<View>('month');
  const [cursor, setCursor] = useState('');
  const [selected, setSelected] = useState('');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [qDraft, setQDraft] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [upcoming, setUpcoming] = useState<Upcoming | null>(null);
  const [isDesktop, setIsDesktop] = useState(true);
  const [form, setForm] = useState<null | { date: string; event?: CalEvent }>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [pay, setPay] = useState<null | { event: CalEvent; mode: 'paid' | 'partial' }>(null);
  const [demoBusy, setDemoBusy] = useState(false);
  const [confirmDemoRemove, setConfirmDemoRemove] = useState(false);
  const { toast, showToast, clearToast } = useToast();
  const reqId = useRef(0);
  const initialised = useRef(false);

  // ---- bootstrap: meta + screen size ----
  useEffect(() => {
    fetch('/api/calendar/meta', { cache: 'no-store' })
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Could not open the calendar.'); return j as Meta; })
      .then(m => { setMeta(m); setCursor(m.today); setSelected(m.today); })
      .catch(e => setMetaError(e.message));
    const mq = window.matchMedia('(min-width: 768px)');
    const set = () => setIsDesktop(mq.matches);
    set();
    mq.addEventListener('change', set);
    return () => mq.removeEventListener('change', set);
  }, []);
  // Deep link from the dashboard / alerts: /calendar?event=12 opens that schedule.
  useEffect(() => {
    if (!meta) return;
    const id = Number(new URLSearchParams(window.location.search).get('event'));
    if (Number.isInteger(id) && id > 0) setDetailId(id);
  }, [meta]);
  // On a phone the first thing shown is the agenda, not a cramped month grid.
  useEffect(() => { if (meta && !initialised.current) { initialised.current = true; if (!window.matchMedia('(min-width: 768px)').matches) setView('agenda'); } }, [meta]);

  // search box: apply after a short pause
  useEffect(() => { const t = setTimeout(() => setFilters(f => (f.q === qDraft.trim() ? f : { ...f, q: qDraft.trim() })), 300); return () => clearTimeout(t); }, [qDraft]);

  const range = useMemo(() => (cursor ? rangeFor(view, cursor) : null), [view, cursor]);
  const month = cursor.slice(0, 7);

  const loadEvents = useCallback(async () => {
    if (!range) return;
    const id = ++reqId.current;
    const p = new URLSearchParams({ from: range.from, to: range.to });
    (['q', 'business_unit_id', 'category', 'status', 'assigned_to'] as const).forEach(k => { if (filters[k]) p.set(k, filters[k]); });
    (['financial_only', 'meetings_only', 'overdue_only'] as const).forEach(k => { if (filters[k]) p.set(k, '1'); });
    try {
      const r = await fetch(`/api/calendar/events?${p}`, { cache: 'no-store' });
      const j = await r.json();
      if (id !== reqId.current) return; // a newer request is in flight
      if (!r.ok) { setLoadError(j.error || 'Could not load the schedule.'); return; }
      setLoadError(''); setEvents(j.events);
    } catch { if (id === reqId.current) setLoadError('Could not reach the server. Check your connection and try again.'); }
    finally { if (id === reqId.current) setLoading(false); }
  }, [range, filters]);
  useEffect(() => { setLoading(true); loadEvents(); }, [loadEvents]);

  const loadSummary = useCallback(async () => {
    if (!month) return;
    try { const r = await fetch(`/api/calendar/summary?month=${month}`, { cache: 'no-store' }); if (r.ok) setSummary(await r.json()); } catch { /* cards keep their last values */ }
  }, [month]);
  const loadUpcoming = useCallback(async () => {
    try { const r = await fetch('/api/calendar/upcoming', { cache: 'no-store' }); if (r.ok) setUpcoming(await r.json()); } catch { /* keep last */ }
  }, []);
  useEffect(() => { loadSummary(); }, [loadSummary]);
  useEffect(() => { loadUpcoming(); }, [loadUpcoming]);

  const refreshAll = useCallback(() => { loadEvents(); loadSummary(); loadUpcoming(); }, [loadEvents, loadSummary, loadUpcoming]);

  // ---- navigation ----
  const step = (dir: -1 | 1) => {
    if (!cursor) return;
    if (view === 'month' || view === 'agenda') { const ym = addMonthsYM(cursor.slice(0, 7), dir); setCursor(`${ym}-01`); setSelected(`${ym}-01`); }
    else { const n = addDays(cursor, dir * (view === 'week' ? 7 : 1)); setCursor(n); setSelected(n); }
  };
  const goToday = () => { if (meta) { setCursor(meta.today); setSelected(meta.today); } };
  const title = !cursor ? '' : view === 'month' || view === 'agenda' ? monthTitle(month)
    : view === 'week' ? `${niceDate(startOfWeek(cursor), { month: 'short', day: 'numeric' })} – ${niceDate(addDays(startOfWeek(cursor), 6), { month: 'short', day: 'numeric', year: 'numeric' })}` : longDate(cursor);

  const openDay = (d: string) => { setCursor(d); setSelected(d); setView('day'); };
  const openAdd = (d?: string) => setForm({ date: d ?? (view === 'day' ? cursor : selected || meta?.today || '') });
  const clearFilters = () => { setFilters(NO_FILTERS); setQDraft(''); };
  const activeFilterCount = (['business_unit_id', 'category', 'status', 'assigned_to'] as const).filter(k => filters[k]).length + (['financial_only', 'meetings_only', 'overdue_only'] as const).filter(k => filters[k]).length + (filters.q ? 1 : 0);

  const demo = async (action: 'load' | 'remove') => {
    setDemoBusy(true);
    try {
      const r = await fetch('/api/calendar/demo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
      const j = await r.json();
      if (!r.ok) { showToast(j.error || 'Could not do that.', 'error'); return; }
      showToast(action === 'load' ? 'Sample schedules added.' : 'Sample schedules removed.');
      setConfirmDemoRemove(false);
      refreshAll();
    } finally { setDemoBusy(false); }
  };

  if (metaError) return <div className="p-6"><div className="card"><p className="text-sm text-red-600" role="alert">{metaError}</p></div></div>;
  if (!meta || !cursor) return <div className="flex justify-center py-24"><Loader2 className="animate-spin text-gray-300" size={28} /></div>;

  const canSeeMoney = summary?.can_see_finance ?? (meta.caps.is_owner || meta.caps.finance || meta.caps.payroll);
  const selectedList = eventsOn(events, selected);

  const select = (k: keyof Filters, v: string) => setFilters(f => ({ ...f, [k]: v }));

  return (
    <div className="p-3 sm:p-4 lg:p-6 space-y-4 pb-24 md:pb-6" data-testid="calendar-page">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2"><CalendarDays className="text-orange-500" size={24} />Calendar / Schedule</h1>
          <p className="text-sm text-gray-500 mt-1">Payments, collections, meetings and deadlines in one place.</p>
        </div>
        <div className="flex items-center gap-2">
          <NotificationBell onView={id => setDetailId(id)} />
          <button className="btn-primary max-md:hidden" onClick={() => openAdd()}><Plus size={16} />Add Schedule</button>
        </div>
      </div>

      {upcoming && canSeeMoney && <OverdueBanner u={upcoming} active={filters.overdue_only} onToggle={() => setFilters(f => ({ ...f, overdue_only: !f.overdue_only, financial_only: !f.overdue_only ? true : f.financial_only }))} />}

      {canSeeMoney && summary && <SummaryCards s={summary} monthLabel={monthTitle(month)} />}

      {/* Toolbar */}
      <div className="card !p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <button aria-label="Previous" onClick={() => step(-1)} className="p-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50"><ChevronLeft size={16} /></button>
            <button onClick={goToday} className="btn-secondary !py-2">Today</button>
            <button aria-label="Next" onClick={() => step(1)} className="p-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50"><ChevronRight size={16} /></button>
          </div>
          <h2 className="text-base sm:text-lg font-semibold text-gray-900 mr-auto" data-testid="cal-title">{title}</h2>
          <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden bg-white" role="tablist" aria-label="Calendar view">
            {(['month', 'week', 'day', 'agenda'] as View[]).map(v => (
              <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} className={`px-3 py-2 text-sm font-medium capitalize ${view === v ? 'bg-orange-500 text-white' : 'text-gray-700 hover:bg-gray-50'}`}>{v}</button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input aria-label="Search schedules" className="form-input pl-9" placeholder="Search title, supplier, employee, reference no., notes…" value={qDraft} onChange={e => setQDraft(e.target.value)} />
          </div>
          <button onClick={() => setShowFilters(s => !s)} aria-expanded={showFilters} className="btn-secondary md:hidden relative"><Filter size={15} />Filters{activeFilterCount > 0 && <span className="ml-1 text-[10px] bg-orange-500 text-white rounded-full px-1.5">{activeFilterCount}</span>}</button>
        </div>

        <div className={`${showFilters ? 'grid' : 'hidden'} md:grid grid-cols-2 md:grid-cols-4 gap-2`}>
          <select aria-label="Business unit" className="form-input" value={filters.business_unit_id} onChange={e => select('business_unit_id', e.target.value)}><option value="">All business units</option>{meta.business_units.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          <select aria-label="Category" className="form-input" value={filters.category} onChange={e => select('category', e.target.value)}><option value="">All categories</option>{meta.categories.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select>
          <select aria-label="Status" className="form-input" value={filters.status} onChange={e => select('status', e.target.value)}><option value="">All statuses</option>{STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
          <select aria-label="Assigned to" className="form-input" value={filters.assigned_to} onChange={e => select('assigned_to', e.target.value)}><option value="">Anyone</option>{meta.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <div className="col-span-2 md:col-span-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-gray-700">
            {([['financial_only', 'Financial only'], ['meetings_only', 'Meetings only'], ['overdue_only', 'Overdue only']] as const).map(([k, l]) => (
              <label key={k} className="inline-flex items-center gap-2"><input type="checkbox" checked={filters[k]} onChange={e => setFilters(f => ({ ...f, [k]: e.target.checked }))} />{l}</label>
            ))}
            {activeFilterCount > 0 && <button onClick={clearFilters} className="inline-flex items-center gap-1 text-orange-600 hover:text-orange-800 font-medium"><X size={14} />Clear Filters</button>}
          </div>
        </div>

        {/* colour legend, so the palette explains itself */}
        <div className="hidden md:flex flex-wrap gap-x-4 gap-y-1 pt-1">
          {meta.categories.map(c => (
            <button key={c.key} onClick={() => select('category', filters.category === c.key ? '' : c.key)} className={`inline-flex items-center gap-1.5 text-[11px] ${filters.category === c.key ? 'font-bold text-gray-900' : 'text-gray-500 hover:text-gray-800'}`}>
              <span className="w-2 h-2 rounded-sm" style={{ background: c.color }} />{catLabel(c.key)}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-4 items-start">
        <div className="card !p-0 overflow-hidden min-w-0" aria-busy={loading}>
          {loadError && <div className="px-4 py-3 text-sm text-red-700 bg-red-50 border-b border-red-100" role="alert">{loadError}</div>}
          {loading && events.length === 0 ? <div className="flex justify-center py-20"><Loader2 className="animate-spin text-gray-300" size={24} /></div> : (
            <>
              {view === 'month' && <MonthView cursor={cursor} today={meta.today} events={events} isDesktop={isDesktop} selected={selected} onSelectDay={setSelected} onAddOn={openAdd} onOpen={e => setDetailId(e.id)} onOpenDay={openDay} />}
              {view === 'week' && <WeekView cursor={cursor} today={meta.today} events={events} onOpen={e => setDetailId(e.id)} onAddOn={openAdd} onOpenDay={openDay} />}
              {view === 'day' && <DayView day={cursor} today={meta.today} events={events} onOpen={e => setDetailId(e.id)} onAddOn={openAdd} />}
              {view === 'agenda' && <AgendaView events={events} today={meta.today} onOpen={e => setDetailId(e.id)} onAddOn={openAdd} />}
            </>
          )}
          {view === 'month' && !isDesktop && (
            <div className="border-t border-gray-100 p-3 space-y-2" data-testid="selected-day">
              <div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-gray-900">{longDate(selected)}</h3><button className="text-xs font-semibold text-orange-600" onClick={() => openAdd(selected)}>+ Add</button></div>
              {selectedList.length === 0 ? <p className="text-sm text-gray-500">Nothing scheduled.</p> : selectedList.map(e => <EventRow key={e.id} e={e} onOpen={ev => setDetailId(ev.id)} />)}
            </div>
          )}
        </div>

        <aside className="space-y-4 min-w-0">
          {upcoming && <TodayWidget u={upcoming} onOpen={e => setDetailId(e.id)} />}
          {upcoming && <WeekWidget u={upcoming} onOpen={e => setDetailId(e.id)} />}
        </aside>
      </div>

      {meta.caps.is_owner && <GoogleSyncPanel onChanged={() => { fetch('/api/calendar/meta', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).then(m => { if (m) setMeta(m); }).catch(() => {}); }} />}

      {meta.caps.is_owner && (
        <div className="text-xs text-gray-400 flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="demo-controls">
          <span>Sample data (Owner only):</span>
          <button disabled={demoBusy} onClick={() => demo('load')} className="font-medium text-gray-500 hover:text-orange-600 underline underline-offset-2">Load sample schedules</button>
          {!confirmDemoRemove
            ? <button onClick={() => setConfirmDemoRemove(true)} className="font-medium text-gray-500 hover:text-red-600 underline underline-offset-2">Remove sample schedules</button>
            : <span className="inline-flex items-center gap-2">Remove all sample schedules?
              <button disabled={demoBusy} onClick={() => demo('remove')} className="font-semibold text-red-600">Yes, remove</button>
              <button onClick={() => setConfirmDemoRemove(false)} className="font-medium text-gray-500">Keep</button></span>}
        </div>
      )}

      {/* Floating add button for phones */}
      <button onClick={() => openAdd()} aria-label="Add schedule" className="md:hidden fixed right-4 bottom-5 z-40 w-14 h-14 rounded-full bg-orange-500 text-white shadow-lg flex items-center justify-center active:scale-95"><Plus size={26} /></button>

      {form && (
        <EventForm meta={meta} initialDate={form.date} event={form.event} onClose={() => setForm(null)}
          onSaved={id => { const wasEdit = !!form.event; setForm(null); showToast(wasEdit ? 'Schedule updated.' : 'Schedule saved.'); refreshAll(); if (wasEdit && id) setDetailId(id); }} />
      )}
      {detailId !== null && !form && !pay && (
        <EventDetail meta={meta} eventId={detailId} onClose={() => setDetailId(null)} onChanged={refreshAll}
          onEdit={e => setForm({ date: e.start_date, event: e })} onPay={(e, mode) => setPay({ event: e, mode })} />
      )}
      {pay && (
        <PaymentDialog event={pay.event} mode={pay.mode} today={meta.today} onClose={() => setPay(null)}
          onDone={warning => { setPay(null); if (warning) showToast(warning, 'error'); else showToast(pay.event.financial_type === 'COLLECTION' ? 'Collection recorded.' : pay.mode === 'paid' ? 'Marked as paid.' : 'Partial payment recorded.'); refreshAll(); }} />
      )}
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}
    </div>
  );
}
