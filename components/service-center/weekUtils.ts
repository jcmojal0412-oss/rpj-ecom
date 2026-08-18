import { todayISO } from '@/lib/utils';

export function toLocalISO(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Returns the Monday of the week containing this date (Mon–Sun cutoff).
export function weekStart(dateStr: string): Date {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

export function weekLabel(monday: Date): string {
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
  const year = sunday.getFullYear();
  return `${fmt(monday)} – ${fmt(sunday)}, ${year}`;
}

export function isCurrentWeek(monday: Date): boolean {
  return toLocalISO(monday) === toLocalISO(weekStart(todayISO()));
}

// Technicians are paid the Monday after their Mon–Sun cutoff closes.
export function payoutDate(monday: Date): Date {
  const d = new Date(monday);
  d.setDate(monday.getDate() + 7);
  return d;
}

export function shortDate(d: Date): string {
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

// Compact "Aug 17–23" (same month) or "Jul 27–Aug 2" (crossing months) —
// the month is only repeated when the week actually spans two of them.
export function shortWeekRange(monday: Date): string {
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const dayOnly = (d: Date) => d.toLocaleDateString('en-PH', { day: 'numeric' });
  return monday.getMonth() === sunday.getMonth()
    ? `${shortDate(monday)}–${dayOnly(sunday)}`
    : `${shortDate(monday)}–${shortDate(sunday)}`;
}

export function monthStart(dateStr: string): Date {
  const d = new Date(dateStr + 'T00:00:00');
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function monthEnd(monthFirst: Date): Date {
  return new Date(monthFirst.getFullYear(), monthFirst.getMonth() + 1, 0);
}

export function monthLabel(monthFirst: Date): string {
  return monthFirst.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
}

export function monthLabelShort(monthFirst: Date): string {
  return monthFirst.toLocaleDateString('en-PH', { month: 'long' });
}

export function shiftMonth(monthFirst: Date, dir: number): Date {
  return new Date(monthFirst.getFullYear(), monthFirst.getMonth() + dir, 1);
}

export function yearStart(dateStr: string): Date {
  const d = new Date(dateStr + 'T00:00:00');
  return new Date(d.getFullYear(), 0, 1);
}

export function yearEnd(yearFirst: Date): Date {
  return new Date(yearFirst.getFullYear(), 11, 31);
}
