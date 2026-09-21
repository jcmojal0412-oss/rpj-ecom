import { addDays, daysBetween, daysInMonth, isISODate, startOfWeek, weekdayOf } from './calendar';

// Repeat rules for the Operations Calendar — pure date maths, no database.
//
//   Does not repeat | Daily | Weekly | Every weekday | Monthly | Yearly | Custom
//
// A rule is stored as (unit, interval, weekdays, month-days):
//   "Every Friday"                    weekly, weekdays [5]
//   "Every Monday and Thursday"       weekly, weekdays [1,4]
//   "Every 8th, 15th, 23rd, 30th"     monthly, month-days [8,15,23,30]
//   "Every 5th of the month"          monthly, month-days [5]
//   "Every 2 weeks"                   custom, unit week, interval 2
// A month-day that a short month does not have (30th / 31st in February) falls on
// that month's LAST day, and is never listed twice.

export type RepeatFreq = 'daily' | 'weekly' | 'weekdays' | 'monthly' | 'yearly' | 'custom';
export type RepeatUnit = 'day' | 'week' | 'month' | 'year';
export type EndType = 'never' | 'until' | 'count';

export interface RepeatRule {
  freq: RepeatFreq;
  unit?: RepeatUnit;          // only for 'custom'
  interval?: number;          // every N units (default 1)
  by_weekday?: number[];      // 0 = Sunday … 6 = Saturday
  by_monthday?: number[];     // 1–31
  end_type?: EndType;
  until?: string | null;      // inclusive, when end_type = 'until'
  count?: number | null;      // total occurrences (start date counts), when end_type = 'count'
}

export interface NormalizedRule {
  freq: RepeatFreq; unit: RepeatUnit; interval: number; by_weekday: number[]; by_monthday: number[];
  end_type: EndType; until: string | null; count: number | null;
}

export const MAX_OCCURRENCES = 1000;

const uniqSorted = (a: number[]) => [...new Set(a)].sort((x, y) => x - y);

// Checks and completes a rule. Returns an error string, or the normalized rule.
export function normalizeRule(rule: RepeatRule, startDate: string): { error: string } | { rule: NormalizedRule } {
  if (!['daily', 'weekly', 'weekdays', 'monthly', 'yearly', 'custom'].includes(rule.freq)) return { error: 'Choose how the schedule repeats.' };
  const interval = rule.interval === undefined || rule.interval === null ? 1 : Number(rule.interval);
  if (!Number.isInteger(interval) || interval < 1 || interval > 365) return { error: 'Repeat every must be a whole number from 1 to 365.' };

  let unit: RepeatUnit;
  if (rule.freq === 'custom') {
    if (!rule.unit || !['day', 'week', 'month', 'year'].includes(rule.unit)) return { error: 'Choose days, weeks or months for the custom repeat.' };
    unit = rule.unit;
  } else unit = ({ daily: 'day', weekdays: 'day', weekly: 'week', monthly: 'month', yearly: 'year' } as const)[rule.freq];

  const wd = uniqSorted(rule.by_weekday ?? []);
  if (wd.some(d => !Number.isInteger(d) || d < 0 || d > 6)) return { error: 'Weekdays must be Sunday to Saturday.' };
  const md = uniqSorted(rule.by_monthday ?? []);
  if (md.some(d => !Number.isInteger(d) || d < 1 || d > 31)) return { error: 'Days of the month must be from 1 to 31.' };

  let by_weekday = wd, by_monthday = md;
  if (rule.freq === 'weekdays') { by_weekday = [1, 2, 3, 4, 5]; by_monthday = []; }
  else if (unit === 'week') { by_weekday = wd.length ? wd : [weekdayOf(startDate)]; by_monthday = []; }
  else if (unit === 'month') { by_monthday = md.length ? md : [Number(startDate.slice(8, 10))]; by_weekday = []; }
  else { by_weekday = []; by_monthday = []; }

  const end_type: EndType = rule.end_type ?? 'never';
  if (!['never', 'until', 'count'].includes(end_type)) return { error: 'Choose when the schedule ends.' };
  let until: string | null = null, count: number | null = null;
  if (end_type === 'until') {
    if (!isISODate(rule.until)) return { error: 'Choose the last date of the schedule.' };
    if (rule.until < startDate) return { error: 'The repeat cannot end before it starts.' };
    until = rule.until;
  }
  if (end_type === 'count') {
    count = Number(rule.count);
    if (!Number.isInteger(count) || count < 1 || count > MAX_OCCURRENCES) return { error: `The number of occurrences must be from 1 to ${MAX_OCCURRENCES}.` };
  }
  return { rule: { freq: rule.freq, unit, interval, by_weekday, by_monthday, end_type, until, count } };
}

// Every date of the series from `startDate` through `throughDate` (inclusive),
// oldest first. The start date is always the first occurrence.
export function expandRule(rule: NormalizedRule, startDate: string, throughDate: string): string[] {
  const out: string[] = [startDate];
  const seen = new Set(out);
  const hardEnd = rule.until && rule.until < throughDate ? rule.until : throughDate;
  const push = (d: string): boolean => {
    if (d <= startDate || d > hardEnd || seen.has(d)) return true;
    if (rule.end_type === 'count' && out.length >= (rule.count ?? 1)) return false;
    if (out.length >= MAX_OCCURRENCES) return false;
    seen.add(d); out.push(d);
    return true;
  };
  if (startDate > hardEnd) return rule.end_type === 'until' && startDate > (rule.until ?? '') ? [] : out.filter(d => d <= throughDate);

  if (rule.unit === 'day') {
    if (rule.freq === 'weekdays') {
      for (let d = addDays(startDate, 1); d <= hardEnd; d = addDays(d, 1)) { const w = weekdayOf(d); if (w >= 1 && w <= 5 && !push(d)) break; }
    } else {
      for (let d = addDays(startDate, rule.interval); d <= hardEnd; d = addDays(d, rule.interval)) if (!push(d)) break;
    }
  } else if (rule.unit === 'week') {
    const anchor = startOfWeek(startDate);
    for (let w = 0; ; w += rule.interval) {
      const weekStart = addDays(anchor, w * 7);
      if (weekStart > hardEnd) break;
      let stop = false;
      for (const wd of rule.by_weekday) { if (!push(addDays(weekStart, wd))) { stop = true; break; } }
      if (stop) break;
    }
  } else if (rule.unit === 'month') {
    const [sy, sm] = startDate.split('-').map(Number);
    for (let k = 0; ; k += rule.interval) {
      const y = sy + Math.floor((sm - 1 + k) / 12), m = ((sm - 1 + k) % 12) + 1;
      const first = `${y}-${String(m).padStart(2, '0')}-01`;
      if (first > hardEnd) break;
      const dim = daysInMonth(y, m);
      let stop = false;
      for (const day of rule.by_monthday) { if (!push(`${y}-${String(m).padStart(2, '0')}-${String(Math.min(day, dim)).padStart(2, '0')}`)) { stop = true; break; } }
      if (stop) break;
    }
  } else { // year
    const [sy, sm, sd] = startDate.split('-').map(Number);
    for (let k = rule.interval; ; k += rule.interval) {
      const y = sy + k;
      if (`${y}-01-01` > hardEnd) break;
      if (!push(`${y}-${String(sm).padStart(2, '0')}-${String(Math.min(sd, daysInMonth(y, sm))).padStart(2, '0')}`)) break;
    }
  }
  return out.sort();
}

// Plain-English summary shown in the event form and details: "Every 8th, 15th, 23rd and 30th of the month".
const ord = (n: number) => `${n}${[11, 12, 13].includes(n % 100) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const list = (a: string[]) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
export function describeRule(r: NormalizedRule): string {
  let base: string;
  if (r.freq === 'weekdays') base = 'Every weekday (Monday to Friday)';
  else if (r.unit === 'day') base = r.interval === 1 ? 'Every day' : `Every ${r.interval} days`;
  else if (r.unit === 'week') base = `${r.interval === 1 ? 'Every' : `Every ${r.interval} weeks on`} ${list(r.by_weekday.map(d => WD[d]))}`.replace('Every Every', 'Every');
  else if (r.unit === 'month') base = `${r.interval === 1 ? 'Every' : `Every ${r.interval} months on the`} ${list(r.by_monthday.map(ord))}${r.interval === 1 ? ' of the month' : ''}`;
  else base = r.interval === 1 ? 'Every year' : `Every ${r.interval} years`;
  if (r.end_type === 'until' && r.until) return `${base}, until ${r.until}`;
  if (r.end_type === 'count' && r.count) return `${base}, ${r.count} times`;
  return base;
}

export const daysUntil = (from: string, to: string) => daysBetween(from, to);
