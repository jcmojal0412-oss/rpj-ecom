'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, ChevronRight } from 'lucide-react';
import { daysBetween, fmtTime12, peso } from '@/lib/calendar';
import { StatusBadge, catColor, niceDate, type CalEvent } from '@/components/calendar/calendar-ui';

interface Payload { today: string; priority: CalEvent[]; overdue: CalEvent[] }

// "Overdue 5 days", "Due today", "Tomorrow", "Sep 22" — the words a person scans for.
function when(e: CalEvent, today: string) {
  const left = daysBetween(today, e.start_date);
  if (e.overdue && left < 0) return `Overdue ${-left} day${left === -1 ? '' : 's'}`;
  if (left === 0) return e.all_day ? 'Today' : `Today, ${fmtTime12(e.start_time)}`;
  if (left === 1) return e.all_day ? 'Tomorrow' : `Tomorrow, ${fmtTime12(e.start_time)}`;
  return `${niceDate(e.start_date, { weekday: 'short', month: 'short', day: 'numeric' })}${e.all_day ? '' : `, ${fmtTime12(e.start_time)}`}`;
}

// CEO dashboard block: the next few things that need attention — overdue payments first,
// then what is due today, expected collections, meetings, payroll and deadlines.
// Renders nothing for people without the Calendar permission.
export default function UpcomingScheduleWidget() {
  const [data, setData] = useState<Payload | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let stop = false;
    fetch('/api/calendar/upcoming', { cache: 'no-store' })
      .then(async r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(j => { if (!stop) setData(j); })
      .catch(() => { if (!stop) setFailed(true); });
    return () => { stop = true; };
  }, []);

  if (failed || !data) return null;
  const items = data.priority.filter(e => !e.masked).slice(0, 8);
  const overdueCount = data.overdue.filter(e => e.financial_type === 'PAYMENT').length;

  return (
    <div className="bg-white border border-[#E5EAF0] rounded-xl p-5 sm:p-6" data-testid="upcoming-schedule">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-sm font-semibold text-[#16233B] flex items-center gap-2"><CalendarDays size={16} className="text-[#B68B3C]" />Upcoming Schedule</h2>
          <p className="text-xs text-[#66758A] mt-1">
            {overdueCount > 0 ? <span className="text-red-700 font-medium">{overdueCount} overdue payment{overdueCount === 1 ? '' : 's'} · </span> : null}
            Overdue and due-today payments first, then collections, meetings and deadlines.
          </p>
        </div>
        <Link href="/calendar" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#E5EAF0] text-sm font-medium text-[#16233B] hover:border-[#B68B3C] hover:text-[#8A6420] transition-colors">View Full Calendar<ChevronRight size={14} /></Link>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-[#66758A]">✅ Nothing urgent is scheduled for the next 7 days.</p>
      ) : (
        <ul className="divide-y divide-[#EEF1F5]">
          {items.map(e => (
            <li key={e.id}>
              <Link href={`/calendar?event=${e.id}`} className="flex items-center gap-3 py-2.5 group">
                <span className="w-1 self-stretch rounded-full shrink-0" style={{ background: e.overdue ? '#A3271F' : catColor(e.category) }} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-[#16233B] truncate group-hover:text-[#8A6420]">{e.event_title}</span>
                  <span className="block text-xs text-[#66758A] truncate">{[when(e, data.today), e.business_unit_name].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="text-right shrink-0">
                  {e.financial_type !== 'NONE' && e.amount != null && <span className="block text-sm font-bold text-[#16233B] tabular-nums">{peso(e.remaining || e.amount)}</span>}
                  {(e.financial_type !== 'NONE' || e.overdue) && <StatusBadge status={e.status} overdue={e.overdue} small />}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
