'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Bell, CalendarClock, Handshake, ListChecks, Wallet } from 'lucide-react';
import { fmtTime12, peso } from '@/lib/calendar';
import { StatusBadge, catColor, niceDate, type CalEvent } from './calendar-ui';

export interface Summary {
  month: string; upcoming_payments: number; paid: number; overdue: number; expected_collections: number; received_collections: number; delayed_collections: number;
  scheduled_net_cash_flow: number; cash_flow: { scheduled_collections: number; scheduled_payments: number; projected: number };
  counts: { payments: number; collections: number; overdue: number }; can_see_finance: boolean;
}
export interface Upcoming { today: string; week: CalEvent[]; overdue: CalEvent[]; today_groups: { meetings: CalEvent[]; payments: CalEvent[]; collections: CalEvent[]; tasks: CalEvent[] }; priority: CalEvent[] }

// ---------- Summary cards for the month ----------
export function SummaryCards({ s, monthLabel }: { s: Summary; monthLabel: string }) {
  const net = s.scheduled_net_cash_flow;
  const cards: { key: string; label: string; value: number; tone: string; hint?: string }[] = [
    { key: 'upcoming', label: 'Upcoming Payments', value: s.upcoming_payments, tone: 'text-blue-800' },
    { key: 'paid', label: 'Paid', value: s.paid, tone: 'text-emerald-700' },
    { key: 'overdue', label: 'Overdue', value: s.overdue, tone: s.overdue > 0 ? 'text-red-700' : 'text-gray-400', hint: s.counts.overdue ? `${s.counts.overdue} unpaid` : undefined },
    { key: 'expected', label: 'Expected Collections', value: s.expected_collections, tone: 'text-emerald-800' },
    { key: 'received', label: 'Received Collections', value: s.received_collections, tone: 'text-emerald-700' },
    { key: 'net', label: 'Scheduled Net Cash Flow', value: net, tone: net < 0 ? 'text-red-700' : 'text-gray-900', hint: 'Expected collections − payments still to go out' },
  ];
  const max = Math.max(s.cash_flow.scheduled_collections, s.cash_flow.scheduled_payments, 1);
  return (
    <div className="space-y-3" data-testid="summary">
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2.5 sm:gap-3">
        {cards.map(c => (
          <div key={c.key} data-card={c.key} className="card !p-3 sm:!p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 leading-tight">{c.label}</p>
            <p className={`mt-1.5 text-base sm:text-lg font-bold tabular-nums break-words ${c.tone}`}>{peso(c.value)}</p>
            {c.hint && <p className="text-[11px] text-gray-400 mt-0.5 leading-tight">{c.hint}</p>}
          </div>
        ))}
      </div>
      <div className="card !p-3 sm:!p-4" data-testid="cash-flow">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="text-sm font-semibold text-gray-900">Scheduled Cash Flow · {monthLabel}</h3>
          <p className="text-[11px] text-gray-400">Planned money in and out from the calendar — not an accounting profit.</p>
        </div>
        <div className="mt-3 space-y-2">
          {[['In — scheduled collections', s.cash_flow.scheduled_collections, '#2E7D5B'], ['Out — scheduled payments', s.cash_flow.scheduled_payments, '#B0443A']].map(([l, v, col]) => (
            <div key={l as string} className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[210px_1fr_auto] items-center gap-x-3 gap-y-1">
              <span className="text-xs text-gray-600">{l as string}</span>
              <div className="max-sm:col-span-2 max-sm:order-3 h-2 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${Math.max(2, ((v as number) / max) * 100)}%`, background: col as string }} /></div>
              <span className="text-xs font-semibold tabular-nums text-gray-800 text-right">{peso(v as number)}</span>
            </div>
          ))}
        </div>
        <p className="mt-2.5 text-xs text-gray-600">Projected: <span className={`font-bold tabular-nums ${s.cash_flow.projected < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{peso(s.cash_flow.projected)}</span></p>
      </div>
    </div>
  );
}

// ---------- Today ----------
const GROUPS: { key: 'meetings' | 'payments' | 'collections' | 'tasks'; label: string; icon: React.ElementType }[] = [
  { key: 'meetings', label: 'Meetings', icon: Handshake }, { key: 'payments', label: 'Payments', icon: Wallet }, { key: 'collections', label: 'Collections', icon: Wallet }, { key: 'tasks', label: 'Tasks & other', icon: ListChecks },
];
function MiniRow({ e, onOpen }: { e: CalEvent; onOpen: (e: CalEvent) => void }) {
  return (
    <button type="button" onClick={() => onOpen(e)} className="w-full text-left flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50">
      <span className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: e.masked ? '#7B8794' : catColor(e.category) }} />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-gray-900 truncate">{e.event_title}</span>
        <span className="block text-[11px] text-gray-500 truncate">
          {[e.all_day ? null : fmtTime12(e.start_time), e.financial_type !== 'NONE' && e.amount != null ? peso(e.remaining || e.amount) : null, e.business_unit_name].filter(Boolean).join(' · ')}
        </span>
      </span>
      {e.financial_type !== 'NONE' && !e.masked && <StatusBadge status={e.status} overdue={e.overdue} small />}
    </button>
  );
}

export function TodayWidget({ u, onOpen }: { u: Upcoming; onOpen: (e: CalEvent) => void }) {
  const total = GROUPS.reduce((n, g) => n + u.today_groups[g.key].length, 0);
  return (
    <div className="card !p-4" data-testid="today-widget">
      <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2"><CalendarClock size={15} className="text-orange-500" />Today <span className="text-xs font-normal text-gray-400">{niceDate(u.today, { weekday: 'long', month: 'short', day: 'numeric' })}</span></h3>
      {total === 0 ? <p className="text-sm text-gray-500 mt-3">Nothing scheduled today.</p> : (
        <div className="mt-2 space-y-2.5">
          {GROUPS.filter(g => u.today_groups[g.key].length > 0).map(g => (
            <div key={g.key}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 px-2 flex items-center gap-1.5"><g.icon size={11} />{g.label} ({u.today_groups[g.key].length})</p>
              {u.today_groups[g.key].map(e => <MiniRow key={e.id} e={e} onOpen={onOpen} />)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function WeekWidget({ u, onOpen }: { u: Upcoming; onOpen: (e: CalEvent) => void }) {
  const byDate = new Map<string, CalEvent[]>();
  for (const e of u.week) (byDate.get(e.start_date) ?? byDate.set(e.start_date, []).get(e.start_date)!).push(e);
  const dates = [...byDate.keys()].sort();
  return (
    <div className="card !p-4" data-testid="week-widget">
      <h3 className="text-sm font-semibold text-gray-900">Upcoming This Week</h3>
      {dates.length === 0 ? <p className="text-sm text-gray-500 mt-3">Nothing coming up in the next 7 days.</p> : (
        <div className="mt-2 space-y-2.5">
          {dates.map(d => (
            <div key={d}>
              <p className={`text-[11px] font-semibold uppercase tracking-wide px-2 ${d === u.today ? 'text-orange-600' : 'text-gray-400'}`}>{d === u.today ? 'Today' : niceDate(d, { weekday: 'short', month: 'short', day: 'numeric' })}</p>
              {(byDate.get(d) as CalEvent[]).map(e => <MiniRow key={e.id} e={e} onOpen={onOpen} />)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function OverdueBanner({ u, active, onToggle }: { u: Upcoming; active: boolean; onToggle: () => void }) {
  const items = u.overdue.filter(e => e.financial_type === 'PAYMENT');
  if (items.length === 0) return null;
  const total = items.reduce((s, e) => s + e.remaining, 0);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5" role="status" data-testid="overdue-banner">
      <AlertTriangle size={16} className="text-red-600 shrink-0" />
      <p className="text-sm text-red-900 flex-1 min-w-[200px]"><span className="font-semibold">{items.length} overdue payment{items.length === 1 ? '' : 's'}</span> · {peso(total)} still unpaid</p>
      <button onClick={onToggle} className="text-xs font-semibold text-red-700 hover:text-red-900 underline underline-offset-2">{active ? 'Show everything' : 'Show only overdue'}</button>
    </div>
  );
}

// ---------- Notification bell (inside RPJ) ----------
interface Notice { id: number; event_id: number; kind: string; title: string; read: boolean; event_title: string; amount: number | null; due: string; business_unit: string | null; category: string; status: string }

export function NotificationBell({ onView }: { onView: (eventId: number) => void }) {
  const [data, setData] = useState<{ unread: number; items: Notice[] } | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try { const r = await fetch('/api/calendar/notifications', { cache: 'no-store' }); if (r.ok) setData(await r.json()); } catch { /* keep the last list */ }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 90_000); return () => clearInterval(t); }, [load]);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const markAll = async () => { await fetch('/api/calendar/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ all: true }) }); load(); };
  const view = async (n: Notice) => {
    if (!n.read) await fetch('/api/calendar/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [n.id] }) });
    setOpen(false); onView(n.event_id); load();
  };
  const unread = data?.unread ?? 0;

  return (
    <div className="relative" ref={box}>
      <button onClick={() => setOpen(o => !o)} aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open} className="relative p-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-600">
        <Bell size={18} />
        {unread > 0 && <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center" data-testid="bell-count">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-[min(92vw,380px)] bg-white border border-gray-200 rounded-xl shadow-xl z-40 overflow-hidden" data-testid="bell-panel">
          <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-gray-100">
            <p className="text-sm font-semibold text-gray-900">Schedule alerts</p>
            {unread > 0 && <button onClick={markAll} className="text-xs font-medium text-orange-600 hover:text-orange-800">Mark all as read</button>}
          </div>
          <div className="max-h-[70vh] overflow-y-auto divide-y divide-gray-50">
            {(data?.items ?? []).length === 0 && <p className="text-sm text-gray-500 px-4 py-6 text-center">No alerts right now.</p>}
            {(data?.items ?? []).map(n => (
              <div key={n.id} className={`px-3.5 py-3 ${n.read ? '' : 'bg-orange-50/50'}`} data-notice-id={n.id}>
                <p className={`text-[11px] font-bold tracking-wide ${/OVERDUE|DELAYED/.test(n.title) ? 'text-red-700' : 'text-orange-700'}`}>{n.title}</p>
                <p className="text-sm font-semibold text-gray-900 mt-0.5 break-words">{n.event_title}</p>
                <p className="text-xs text-gray-500 mt-0.5">{[n.amount ? peso(n.amount) : null, `Due: ${niceDate(n.due, { month: 'long', day: 'numeric', year: 'numeric' })}`, n.business_unit].filter(Boolean).join(' · ')}</p>
                <button onClick={() => view(n)} className="mt-2 text-xs font-semibold text-white bg-orange-500 hover:bg-orange-600 rounded-md px-2.5 py-1.5">View Schedule</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
