// Pure attendance computation engine — no DB access here, so it's safely
// reusable from API routes, the background job, and (if ever needed) a
// standalone test script. All date/time logic follows the same GMT+8
// "PH-local via +8h offset" convention already used throughout this app
// (see lib/utils.ts's todayISO()).
import { todayISO } from './utils';

export type EventType = 'TIME_IN' | 'COFFEE_OUT' | 'COFFEE_IN' | 'LUNCH_OUT' | 'LUNCH_IN' | 'TIME_OUT';

export interface AttendanceEvent {
  id: number;
  event_type: EventType;
  event_time: string; // UTC ISO timestamp
  superseded_by: number | null;
}

// V1 ships ONE global config (see parseAttendanceSettings below, sourced
// from the shared app_settings key-value table — no scoping column). Every
// function here only ever takes a single AttendanceSettings object and a
// user's own events, never touching the DB directly, so a future
// per-employee/per-branch/multi-shift version can resolve "which settings
// apply to this user" upstream (e.g. via a join against a new
// attendance_shifts table) without changing anything in this file.
export interface AttendanceSettings {
  work_start: string;              // "09:00", PH-local wall time
  work_end: string;                // "18:00"
  grace_period_minutes: number;
  lunch_break_minutes: number;
  coffee_break_minutes: number;
  coffee_breaks_allowed: number;
  lunch_break_paid: boolean;
  coffee_break_paid: boolean;
  min_minutes_before_ot: number;
  selfie_required: boolean;        // gates TIME_IN/TIME_OUT only — see eventRequiresSelfie()
  work_days: number[];             // 0=Sun..6=Sat
}

export function parseAttendanceSettings(rows: { key: string; value: string }[]): AttendanceSettings {
  const map = new Map(rows.map(r => [r.key, r.value]));
  const get = (k: string, fallback: string) => map.get(k) ?? fallback;
  return {
    work_start: get('attendance_work_start', '09:00'),
    work_end: get('attendance_work_end', '18:00'),
    grace_period_minutes: Number(get('attendance_grace_period_minutes', '15')),
    lunch_break_minutes: Number(get('attendance_lunch_break_minutes', '60')),
    coffee_break_minutes: Number(get('attendance_coffee_break_minutes', '10')),
    coffee_breaks_allowed: Number(get('attendance_coffee_breaks_allowed', '2')),
    lunch_break_paid: get('attendance_lunch_break_paid', '0') === '1',
    coffee_break_paid: get('attendance_coffee_break_paid', '0') === '1',
    min_minutes_before_ot: Number(get('attendance_min_minutes_before_ot', '30')),
    selfie_required: get('attendance_selfie_required', '1') === '1',
    work_days: get('attendance_work_days', '1,2,3,4,5').split(',').filter(Boolean).map(Number),
  };
}

export function settingsToRows(s: AttendanceSettings): [string, string][] {
  return [
    ['attendance_work_start', s.work_start],
    ['attendance_work_end', s.work_end],
    ['attendance_grace_period_minutes', String(s.grace_period_minutes)],
    ['attendance_lunch_break_minutes', String(s.lunch_break_minutes)],
    ['attendance_coffee_break_minutes', String(s.coffee_break_minutes)],
    ['attendance_coffee_breaks_allowed', String(s.coffee_breaks_allowed)],
    ['attendance_lunch_break_paid', s.lunch_break_paid ? '1' : '0'],
    ['attendance_coffee_break_paid', s.coffee_break_paid ? '1' : '0'],
    ['attendance_min_minutes_before_ot', String(s.min_minutes_before_ot)],
    ['attendance_selfie_required', s.selfie_required ? '1' : '0'],
    ['attendance_work_days', s.work_days.join(',')],
  ];
}

const PH_OFFSET_MS = 8 * 60 * 60 * 1000;

function phMinutesOfDay(isoTimestamp: string): number {
  const d = new Date(new Date(isoTimestamp).getTime() + PH_OFFSET_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function parseHHMM(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function minutesBetween(fromIso: string, toIso: string): number {
  return Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60_000);
}

function activeEvents(events: AttendanceEvent[]): AttendanceEvent[] {
  return events.filter(e => e.superseded_by === null).sort((a, b) => a.event_time.localeCompare(b.event_time));
}

export function isConfiguredWorkDay(dateStr: string, settings: AttendanceSettings): boolean {
  const dow = new Date(dateStr + 'T00:00:00').getDay();
  return settings.work_days.includes(dow);
}

// True once PH-local "now" has passed work_end + grace — i.e. today's shift
// window is effectively over, even though the calendar date is still today.
export function isTodayFinalized(settings: AttendanceSettings): boolean {
  const nowPH = new Date(Date.now() + PH_OFFSET_MS);
  const nowMinutes = nowPH.getUTCHours() * 60 + nowPH.getUTCMinutes();
  return nowMinutes >= parseHHMM(settings.work_end) + settings.grace_period_minutes;
}

// A selfie is only ever required for the two Work Time punches — breaks
// never require one, regardless of the selfie_required toggle.
export function eventRequiresSelfie(eventType: EventType, settings: AttendanceSettings): boolean {
  return settings.selfie_required && (eventType === 'TIME_IN' || eventType === 'TIME_OUT');
}

export type AttendanceStatus = 'not_started' | 'present' | 'late' | 'absent' | 'half_day' | 'undertime';

export interface DaySummary {
  status: AttendanceStatus;
  totalWorkMinutes: number;
  breakMinutes: number;
  excessBreakMinutes: number;
  potentialOtMinutes: number;
  lateMinutes: number;
  undertimeMinutes: number;
}

/**
 * isFinalized: true once the day can no longer receive new clock events —
 * either it's a strictly past calendar date, or it's today but
 * isTodayFinalized(settings) is true. Only once finalized can a missing
 * Time In become "absent" instead of "not started yet" — during an active
 * workday, an employee who hasn't clocked in is 'not_started', never
 * 'absent'. Callers should only invoke this for configured work days
 * (see isConfiguredWorkDay) — non-work-days aren't attendance rows at all.
 */
export function computeDaySummary(events: AttendanceEvent[], settings: AttendanceSettings, isFinalized: boolean): DaySummary {
  const active = activeEvents(events);
  const timeIn = active.find(e => e.event_type === 'TIME_IN') ?? null;
  const timeOutEvents = active.filter(e => e.event_type === 'TIME_OUT');
  const timeOut = timeOutEvents.length ? timeOutEvents[timeOutEvents.length - 1] : null;

  const workStart = parseHHMM(settings.work_start);
  const workEnd = parseHHMM(settings.work_end);

  if (!timeIn) {
    return {
      status: isFinalized ? 'absent' : 'not_started',
      totalWorkMinutes: 0, breakMinutes: 0, excessBreakMinutes: 0,
      potentialOtMinutes: 0, lateMinutes: 0, undertimeMinutes: 0,
    };
  }

  // Pair up breaks in chronological order — lunch (one pair/day) and coffee
  // (multiple pairs, up to coffee_breaks_allowed).
  let lunchMinutes = 0, lunchExcess = 0;
  let coffeeMinutes = 0, coffeeExcess = 0;
  let pendingLunchOut: AttendanceEvent | null = null;
  let pendingCoffeeOut: AttendanceEvent | null = null;

  for (const e of active) {
    if (e.event_type === 'LUNCH_OUT') {
      pendingLunchOut = e;
    } else if (e.event_type === 'LUNCH_IN' && pendingLunchOut) {
      const dur = minutesBetween(pendingLunchOut.event_time, e.event_time);
      lunchMinutes += dur;
      lunchExcess += Math.max(0, dur - settings.lunch_break_minutes);
      pendingLunchOut = null;
    } else if (e.event_type === 'COFFEE_OUT') {
      pendingCoffeeOut = e;
    } else if (e.event_type === 'COFFEE_IN' && pendingCoffeeOut) {
      const dur = minutesBetween(pendingCoffeeOut.event_time, e.event_time);
      coffeeMinutes += dur;
      coffeeExcess += Math.max(0, dur - settings.coffee_break_minutes);
      pendingCoffeeOut = null;
    }
  }

  const breakMinutes = lunchMinutes + coffeeMinutes;
  const excessBreakMinutes = lunchExcess + coffeeExcess;
  const lateMinutes = Math.max(0, phMinutesOfDay(timeIn.event_time) - (workStart + settings.grace_period_minutes));

  let totalWorkMinutes = 0;
  let undertimeMinutes = 0;
  let potentialOtMinutes = 0;

  if (timeOut) {
    const grossSpan = Math.max(0, minutesBetween(timeIn.event_time, timeOut.event_time));
    // Paid/unpaid is evaluated per break type independently: if a break
    // type is paid, only its EXCESS beyond the allotted duration is
    // deducted from worked time; if unpaid, the whole break is deducted.
    const deduction = (settings.lunch_break_paid ? lunchExcess : lunchMinutes)
                     + (settings.coffee_break_paid ? coffeeExcess : coffeeMinutes);
    totalWorkMinutes = Math.max(0, grossSpan - deduction);

    const timeOutMinutesOfDay = phMinutesOfDay(timeOut.event_time);
    undertimeMinutes = Math.max(0, workEnd - timeOutMinutesOfDay);

    // OT eligibility gate: early Time In is NEVER overtime (only ever
    // evaluated off Time Out vs work_end), and anything under
    // min_minutes_before_ot doesn't even get flagged as "potential."
    const rawExcess = timeOutMinutesOfDay - workEnd;
    if (rawExcess >= settings.min_minutes_before_ot) potentialOtMinutes = rawExcess;
  } else if (isFinalized) {
    // Clocked in but the day ended with no Time Out recorded — surface as
    // undertime against the full shift rather than silently vanishing;
    // an admin/employee correction is the intended fix path.
    undertimeMinutes = Math.max(0, workEnd - workStart);
  }

  const shiftMinutes = Math.max(1, workEnd - workStart);
  const halfDayThreshold = shiftMinutes * 0.5;

  let status: AttendanceStatus;
  if ((timeOut || isFinalized) && totalWorkMinutes > 0 && totalWorkMinutes < halfDayThreshold) {
    status = 'half_day';
  } else if (lateMinutes > 0) {
    status = 'late';
  } else if (undertimeMinutes > 0) {
    status = 'undertime';
  } else {
    status = 'present';
  }

  return { status, totalWorkMinutes, breakMinutes, excessBreakMinutes, potentialOtMinutes, lateMinutes, undertimeMinutes };
}

export type DayState = 'not_started' | 'working' | 'on_lunch' | 'on_coffee' | 'ended';

export interface EmployeeDayState {
  state: DayState;
  coffeeBreaksUsed: number;
  coffeeBreaksRemaining: number;
  lunchTaken: boolean;
  canTimeIn: boolean;
  canTimeOut: boolean;
  canLunchOut: boolean;
  canLunchIn: boolean;
  canCoffeeOut: boolean;
  canCoffeeIn: boolean;
}

// Strict state machine over today's events — the single source of truth for
// both which buttons the employee screen enables AND server-side rejection
// of duplicate/out-of-sequence clock actions (the clock API route re-derives
// this from the DB on every POST and checks the requested event_type
// against the relevant can* flag before inserting anything).
export function getEmployeeDayState(events: AttendanceEvent[], settings: AttendanceSettings): EmployeeDayState {
  const active = activeEvents(events);
  let state: DayState = 'not_started';
  let coffeeBreaksUsed = 0;
  let lunchTaken = false;

  for (const e of active) {
    switch (e.event_type) {
      case 'TIME_IN':
        if (state === 'not_started') state = 'working';
        break;
      case 'LUNCH_OUT':
        if (state === 'working') state = 'on_lunch';
        break;
      case 'LUNCH_IN':
        if (state === 'on_lunch') { state = 'working'; lunchTaken = true; }
        break;
      case 'COFFEE_OUT':
        if (state === 'working') state = 'on_coffee';
        break;
      case 'COFFEE_IN':
        if (state === 'on_coffee') { state = 'working'; coffeeBreaksUsed++; }
        break;
      case 'TIME_OUT':
        if (state === 'working') state = 'ended';
        break;
    }
  }

  const coffeeBreaksRemaining = Math.max(0, settings.coffee_breaks_allowed - coffeeBreaksUsed);

  return {
    state,
    coffeeBreaksUsed,
    coffeeBreaksRemaining,
    lunchTaken,
    canTimeIn: state === 'not_started',
    canTimeOut: state === 'working',
    canLunchOut: state === 'working' && !lunchTaken,
    canLunchIn: state === 'on_lunch',
    canCoffeeOut: state === 'working' && coffeeBreaksRemaining > 0,
    canCoffeeIn: state === 'on_coffee',
  };
}

export { todayISO };
