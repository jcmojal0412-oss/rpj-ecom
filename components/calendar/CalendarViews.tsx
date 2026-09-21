'use client';

import { Fragment } from 'react';
import { Lock } from 'lucide-react';
import { addDays, compactPeso, fmtTime12, monthBounds, peso, startOfWeek } from '@/lib/calendar';
import { CategoryChip, StatusBadge, catColor, catSoft, longDate, niceDate, type CalEvent } from './calendar-ui';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const covers = (e: CalEvent, day: string) => e.start_date <= day && e.end_date >= day;
export const eventsOn = (events: CalEvent[], day: string) =>
  events.filter(e => covers(e, day)).sort((a, b) => (a.all_day ? 0 : 1) - (b.all_day ? 0 : 1) || (a.start_time ?? '').localeCompare(b.start_time ?? '') || a.id - b.id);

// The words on a compact chip: "₱105K Rent Due", "3:00 PM Marketing Meeting".
export function chipText(e: CalEvent) {
  if (e.masked) return 'Private Schedule';
  if (e.financial_type !== 'NONE' && e.amount != null) return `${compactPeso(e.amount)} ${e.event_title}`;
  return `${!e.all_day && e.start_time ? `${fmtTime12(e.start_time)} ` : ''}${e.event_title}`;
}

const isDone = (e: CalEvent) => ['paid', 'received', 'completed'].includes(e.status);

export function EventChip({ e, onOpen }: { e: CalEvent; onOpen: (e: CalEvent) => void }) {
  const color = e.masked ? '#7B8794' : catColor(e.category);
  const soft = e.masked ? '#EEF0F3' : catSoft(e.category);
  const bad = e.overdue && !isDone(e);
  return (
    <button
      type="button"
      onClick={ev => { ev.stopPropagation(); onOpen(e); }}
      title={`${chipText(e)}${e.masked ? '' : ` — ${e.status.replace('_', ' ')}`}`}
      data-event-id={e.id}
      className={`w-full text-left flex items-center gap-1 rounded px-1.5 py-[3px] text-[11px] leading-tight font-medium truncate border-l-[3px] hover:brightness-95 ${e.status === 'cancelled' ? 'opacity-60 line-through' : ''}`}
      style={{ background: bad ? '#F9E1DE' : soft, color: bad ? '#A3271F' : color, borderLeftColor: bad ? '#A3271F' : color }}
    >
      {e.masked && <Lock size={10} className="shrink-0" />}
      {isDone(e) && <span aria-label="done" className="shrink-0 text-[10px]">✓</span>}
      <span className="truncate">{chipText(e)}</span>
    </button>
  );
}

// ---------- Month ----------
export function MonthView({ cursor, today, events, isDesktop, selected, onSelectDay, onAddOn, onOpen, onOpenDay }: {
  cursor: string; today: string; events: CalEvent[]; isDesktop: boolean; selected: string; onSelectDay: (d: string) => void; onAddOn: (d: string) => void; onOpen: (e: CalEvent) => void; onOpenDay: (d: string) => void;
}) {
  const ym = cursor.slice(0, 7);
  const first = monthBounds(ym).from;
  const gridStart = startOfWeek(first);
  const lastDay = monthBounds(ym).to;
  const weeks = Math.ceil((Date.parse(lastDay) - Date.parse(gridStart)) / 86_400_000 / 7 + 1 / 7);
  const days = Array.from({ length: weeks * 7 }, (_, i) => addDays(gridStart, i));
  const MAX = isDesktop ? 3 : 0;

  return (
    <div data-testid="month-grid">
      <div className="grid grid-cols-7 border-b border-gray-100">
        {DOW.map(d => <div key={d} className="py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-500">{isDesktop ? d : d[0]}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day, i) => {
          const inMonth = day.slice(0, 7) === ym;
          const list = eventsOn(events, day);
          const isToday = day === today;
          const isSel = !isDesktop && day === selected;
          const shown = MAX ? list.slice(0, MAX) : [];
          const more = MAX ? list.length - shown.length : 0;
          return (
            <div
              key={day}
              role="gridcell"
              data-date={day}
              onClick={() => (isDesktop ? onAddOn(day) : onSelectDay(day))}
              className={`min-h-[52px] md:min-h-[112px] border-b border-r border-gray-100 p-1 md:p-1.5 cursor-pointer transition-colors ${i % 7 === 0 ? 'border-l' : ''} ${inMonth ? 'bg-white hover:bg-orange-50/40' : 'bg-gray-50/70 text-gray-400'} ${isSel ? 'ring-2 ring-inset ring-orange-400' : ''}`}
            >
              <div className="flex justify-center md:justify-between items-start">
                <button
                  type="button"
                  aria-label={`Open ${longDate(day)}`}
                  onClick={ev => { ev.stopPropagation(); if (isDesktop) onOpenDay(day); else onSelectDay(day); }}
                  className={`text-xs font-semibold w-6 h-6 md:w-6 md:h-6 flex items-center justify-center rounded-full ${isToday ? 'bg-orange-500 text-white' : inMonth ? 'text-gray-700 hover:bg-gray-100' : 'text-gray-400'}`}
                >{Number(day.slice(8, 10))}</button>
              </div>
              {isDesktop ? (
                <div className="mt-1 space-y-[3px]">
                  {shown.map(e => <EventChip key={`${e.id}-${day}`} e={e} onOpen={onOpen} />)}
                  {more > 0 && <button type="button" onClick={ev => { ev.stopPropagation(); onOpenDay(day); }} className="text-[11px] font-semibold text-gray-500 hover:text-orange-600 px-1">+{more} more</button>}
                </div>
              ) : list.length > 0 && (
                <div className="flex justify-center flex-wrap gap-[3px] mt-1" aria-label={`${list.length} schedules`}>
                  {list.slice(0, 3).map(e => <span key={e.id} className="w-1.5 h-1.5 rounded-full" style={{ background: e.overdue && !isDone(e) ? '#A3271F' : e.masked ? '#7B8794' : catColor(e.category) }} />)}
                  {list.length > 3 && <span className="text-[9px] leading-none text-gray-500">+</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- One event as a row/card (Agenda, Day, Week, mobile day list) ----------
export function EventRow({ e, onOpen, showDate }: { e: CalEvent; onOpen: (e: CalEvent) => void; showDate?: boolean }) {
  const color = e.masked ? '#7B8794' : catColor(e.category);
  const financial = e.financial_type !== 'NONE' && e.amount != null;
  return (
    <button
      type="button"
      onClick={() => onOpen(e)}
      data-event-id={e.id}
      className={`w-full text-left flex gap-3 rounded-xl border border-gray-100 bg-white hover:border-gray-200 hover:shadow-sm px-3 py-2.5 transition ${e.status === 'cancelled' ? 'opacity-60' : ''}`}
    >
      <span className="w-1 rounded-full shrink-0 self-stretch" style={{ background: e.overdue && !isDone(e) ? '#A3271F' : color }} />
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-2">
          <span className={`text-sm font-semibold text-gray-900 break-words ${e.status === 'cancelled' ? 'line-through' : ''}`}>
            {e.masked && <Lock size={12} className="inline mr-1 -mt-0.5 text-gray-400" />}{e.event_title}
          </span>
          {financial && <span className="text-sm font-bold text-gray-900 tabular-nums shrink-0">{peso(e.amount as number)}</span>}
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-xs text-gray-500">
          {showDate && <span>{niceDate(e.start_date, { weekday: 'short', month: 'short', day: 'numeric' })}</span>}
          <span>{e.all_day ? 'All day' : `${fmtTime12(e.start_time)}${e.end_time ? ` – ${fmtTime12(e.end_time)}` : ''}`}</span>
          {!e.masked && <CategoryChip category={e.category} />}
          {!e.masked && e.business_unit_name && <span>{e.business_unit_name}</span>}
          {!e.masked && e.payee && <span className="truncate max-w-[200px]">{e.payee}</span>}
        </span>
        {!e.masked && (e.financial_type !== 'NONE' || e.event_type === 'task') && (
          <span className="flex items-center gap-2 mt-1.5">
            <StatusBadge status={e.status} overdue={e.overdue} small />
            {financial && e.paid > 0 && e.remaining > 0 && <span className="text-[11px] text-gray-500 tabular-nums">Balance {peso(e.remaining)}</span>}
          </span>
        )}
      </span>
    </button>
  );
}

// ---------- Agenda ----------
export function AgendaView({ events, today, onOpen, onAddOn }: { events: CalEvent[]; today: string; onOpen: (e: CalEvent) => void; onAddOn: (d: string) => void }) {
  const dates = [...new Set(events.flatMap(e => {
    const out: string[] = [];
    for (let d = e.start_date; d <= e.end_date && out.length < 40; d = addDays(d, 1)) out.push(d);
    return out;
  }))].sort();
  if (dates.length === 0) {
    return (
      <div className="text-center py-14 px-4">
        <p className="text-sm text-gray-500">Nothing scheduled here.</p>
        <button className="btn-primary mt-3" onClick={() => onAddOn(today)}>+ Add Schedule</button>
      </div>
    );
  }
  return (
    <div className="p-3 sm:p-4 space-y-4" data-testid="agenda">
      {dates.map(d => (
        <section key={d} data-agenda-date={d}>
          <h3 className={`text-xs font-bold uppercase tracking-wide mb-2 flex items-center gap-2 ${d === today ? 'text-orange-600' : 'text-gray-500'}`}>
            {niceDate(d, { weekday: 'long', month: 'long', day: 'numeric' })}{d === today && <span className="text-[10px] bg-orange-500 text-white rounded px-1.5 py-0.5">TODAY</span>}
          </h3>
          <div className="space-y-2">{eventsOn(events, d).map(e => <EventRow key={`${e.id}-${d}`} e={e} onOpen={onOpen} />)}</div>
        </section>
      ))}
    </div>
  );
}

// ---------- Week ----------
export function WeekView({ cursor, today, events, onOpen, onAddOn, onOpenDay }: { cursor: string; today: string; events: CalEvent[]; onOpen: (e: CalEvent) => void; onAddOn: (d: string) => void; onOpenDay: (d: string) => void }) {
  const start = startOfWeek(cursor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return (
    <div className="grid grid-cols-1 md:grid-cols-7 md:divide-x divide-gray-100" data-testid="week-grid">
      {days.map((d, i) => {
        const list = eventsOn(events, d);
        return (
          <div key={d} data-date={d} className={`p-2 md:min-h-[320px] max-md:border-b max-md:border-gray-100 ${d === today ? 'bg-orange-50/40' : ''}`}>
            <div className="flex items-center justify-between md:block mb-2">
              <button type="button" onClick={() => onOpenDay(d)} className="text-left">
                <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">{DOW[i]}</span>
                <span className={`inline-flex items-center justify-center text-sm font-bold w-7 h-7 rounded-full ${d === today ? 'bg-orange-500 text-white' : 'text-gray-800'}`}>{Number(d.slice(8, 10))}</span>
              </button>
              <button type="button" onClick={() => onAddOn(d)} aria-label={`Add schedule on ${longDate(d)}`} className="md:hidden text-xs font-medium text-orange-600 px-2 py-1">+ Add</button>
            </div>
            <div className="space-y-1.5">
              {list.map(e => (
                <Fragment key={`${e.id}-${d}`}>
                  <div className="md:hidden"><EventRow e={e} onOpen={onOpen} /></div>
                  <div className="hidden md:block"><EventChip e={e} onOpen={onOpen} /></div>
                </Fragment>
              ))}
              {list.length === 0 && <p className="text-xs text-gray-300 md:hidden">Nothing scheduled</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------- Day ----------
export function DayView({ day, today, events, onOpen, onAddOn }: { day: string; today: string; events: CalEvent[]; onOpen: (e: CalEvent) => void; onAddOn: (d: string) => void }) {
  const list = eventsOn(events, day);
  const untimed = list.filter(e => e.all_day || !e.start_time);
  const timed = list.filter(e => !e.all_day && e.start_time);
  const hours = Array.from({ length: 17 }, (_, i) => i + 6); // 6 AM – 10 PM
  const outside = timed.filter(e => Number((e.start_time as string).slice(0, 2)) < 6 || Number((e.start_time as string).slice(0, 2)) > 22);
  return (
    <div className="p-3 sm:p-4 space-y-4" data-testid="day-view">
      <div className="flex items-center justify-between gap-2">
        <h3 className={`text-sm font-bold ${day === today ? 'text-orange-600' : 'text-gray-800'}`}>{longDate(day)}{day === today && ' · Today'}</h3>
        <button className="btn-secondary text-xs !py-1.5" onClick={() => onAddOn(day)}>+ Add</button>
      </div>
      {list.length === 0 && <p className="text-sm text-gray-500 py-6 text-center">Nothing scheduled for this day.</p>}
      {untimed.length > 0 && (
        <section>
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">All day / due</h4>
          <div className="space-y-2">{untimed.map(e => <EventRow key={e.id} e={e} onOpen={onOpen} />)}</div>
        </section>
      )}
      {timed.length > 0 && (
        <section>
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Schedule</h4>
          <div className="divide-y divide-gray-100 border-y border-gray-100">
            {outside.length > 0 && (
              <div className="grid grid-cols-[56px_1fr] gap-2 py-1.5">
                <span className="text-[11px] text-gray-400 pt-2">Other</span>
                <div className="space-y-1.5">{outside.map(e => <EventRow key={e.id} e={e} onOpen={onOpen} />)}</div>
              </div>
            )}
            {hours.map(h => {
              const inHour = timed.filter(e => Number((e.start_time as string).slice(0, 2)) === h);
              return (
                <div key={h} className="grid grid-cols-[56px_1fr] gap-2 py-1.5 min-h-[36px]">
                  <span className="text-[11px] text-gray-400 pt-1.5 tabular-nums">{fmtTime12(`${String(h).padStart(2, '0')}:00`)}</span>
                  <div className="space-y-1.5">{inHour.map(e => <EventRow key={e.id} e={e} onOpen={onOpen} />)}</div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
