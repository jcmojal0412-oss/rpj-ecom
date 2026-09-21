import type Database from 'better-sqlite3';
import {
  CATEGORY_BY_KEY, addDays, daysBetween, displayStatus, financialTypeFor, isISODate, isTime, kindFor, monthBounds, reminderHeadline, round2, type FinancialType, type Privacy,
} from './calendar';
import { describeRule, expandRule, normalizeRule, type NormalizedRule, type RepeatRule } from './calendar-recurrence';

// RPJ Operations Calendar — everything that touches the database: who may see or
// change what, status and balance, payments, repeats, reminders, audit. Routes
// stay thin and call these; nothing here trusts the browser.

export class CalendarError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

// ---------------- who is asking ----------------
export interface Caps { userId: number; isOwner: boolean; finance: boolean; payroll: boolean }
export function capsOf(s: { id: number; role: string; permissions: string[] }): Caps {
  const owner = s.role === 'owner';
  return { userId: s.id, isOwner: owner, finance: owner || s.permissions.includes('calendar_finance'), payroll: owner || s.permissions.includes('payroll') };
}
// Financial schedules are Finance's (and the Owner's); HR (payroll permission) also manages the Payroll ones.
export const canManageFinancial = (c: Caps, category: string) => c.isOwner || c.finance || (category === 'payroll' && c.payroll);

type Level = 'full' | 'masked' | 'hidden';
interface VisRow { financial_type: string; category: string; privacy: string; created_by: number | null; assigned_user_id: number | null }

// What this person may see of an event.
//   financial  : Owner / Finance (and HR for payroll), the person who made or is assigned it, or anyone if it was made Public.
//   otherwise  : Public = everyone; Restricted = involved people + Finance; Private = the same, but everyone
//                else still sees a "Private Schedule" placeholder (time only, nothing else).
export function viewLevel(c: Caps, ev: VisRow, attendeeIds: number[]): Level {
  if (c.isOwner) return 'full';
  const involved = ev.created_by === c.userId || ev.assigned_user_id === c.userId;
  if (ev.financial_type !== 'NONE') return canManageFinancial(c, ev.category) || involved || ev.privacy === 'public' ? 'full' : 'hidden';
  if (ev.privacy === 'public') return 'full';
  if (c.finance || involved || (ev.privacy === 'restricted' && attendeeIds.includes(c.userId))) return 'full';
  return ev.privacy === 'private' ? 'masked' : 'hidden';
}
const canEditEvent = (c: Caps, ev: VisRow) => (ev.financial_type !== 'NONE' ? canManageFinancial(c, ev.category) : c.isOwner || ev.created_by === c.userId);

// ---------------- audit ----------------
export function audit(db: Database.Database, eventId: number, actor: number | null, action: string, details: string | null) {
  db.prepare('INSERT INTO calendar_event_audit_logs (event_id, actor_user_id, action, details) VALUES (?, ?, ?, ?)').run(eventId, actor, action, details);
}

// ---------------- input ----------------
export interface EventInput {
  event_title?: string; category?: string; business_unit_id?: number | null; assigned_user_id?: number | null;
  start_date?: string; end_date?: string | null; start_time?: string | null; end_time?: string | null; all_day?: boolean;
  description?: string | null; privacy?: Privacy; financial_type?: string | null;
  amount?: number | null; payee?: string | null; payment_method?: string | null; reference_no?: string | null; account_bank?: string | null;
  meeting_location?: string | null; meeting_link?: string | null;
  attendees?: { user_id?: number | null; name?: string; email?: string | null }[];
  reminders?: number[];
  recurrence?: RepeatRule | null;
}
const clean = (v: unknown, max: number) => { const s = typeof v === 'string' ? v.trim() : ''; return s ? s.slice(0, max) : null; };

interface Cleaned {
  event_title: string; category: string; event_type: string; financial_type: FinancialType; business_unit_id: number | null; assigned_user_id: number | null;
  start_date: string; end_date: string; start_time: string | null; end_time: string | null; all_day: number; description: string | null; privacy: Privacy;
  amount: number | null; payee: string | null; payment_method: string | null; reference_no: string | null; account_bank: string | null;
  meeting_location: string | null; meeting_link: string | null;
  attendees: { user_id: number | null; name: string; email: string | null }[]; reminders: number[]; rule: NormalizedRule | null;
}

// Checks a whole event and returns clean values, or throws a CalendarError in plain words.
export function cleanInput(db: Database.Database, i: EventInput, base?: { start_date: string; end_date: string; category: string }): Cleaned {
  const title = clean(i.event_title, 200);
  if (!title) throw new CalendarError('Event title is required.');
  const category = i.category ?? base?.category ?? '';
  if (!CATEGORY_BY_KEY[category]) throw new CalendarError('Choose a category.');

  const start = i.start_date ?? base?.start_date;
  if (!isISODate(start)) throw new CalendarError('Date is not a valid date.');
  const end = i.end_date ? i.end_date : (base && !i.start_date ? base.end_date : start);
  if (!isISODate(end)) throw new CalendarError('End date is not a valid date.');
  if (end < start) throw new CalendarError('The end date cannot be before the start date.');
  if (start < '2000-01-01' || end > '2100-12-31') throw new CalendarError('Date is out of range.');

  const allDay = i.all_day !== false;
  let startTime: string | null = null, endTime: string | null = null;
  if (!allDay) {
    if (!isTime(i.start_time)) throw new CalendarError('Start time is required (e.g. 3:00 PM) unless the event is All Day.');
    startTime = i.start_time;
    if (i.end_time) {
      if (!isTime(i.end_time)) throw new CalendarError('End time is not a valid time.');
      if (end === start && i.end_time <= startTime) throw new CalendarError('The end time must be later than the start time.');
      endTime = i.end_time;
    }
  }

  const financial = financialTypeFor(category, i.financial_type);
  let amount: number | null = null;
  if (financial !== 'NONE') {
    const n = Number(i.amount);
    if (i.amount === null || i.amount === undefined || (i.amount as unknown) === '' || !Number.isFinite(n)) throw new CalendarError('Amount is required for a payment or collection.');
    if (n < 0) throw new CalendarError('Amount cannot be negative.');
    if (n === 0) throw new CalendarError('Amount must be more than ₱0.');
    if (n > 1_000_000_000) throw new CalendarError('Amount is too large.');
    amount = round2(n);
  }

  let businessUnit: number | null = null;
  if (i.business_unit_id) {
    if (!db.prepare('SELECT 1 FROM calendar_business_units WHERE id = ? AND active = 1').get(i.business_unit_id)) throw new CalendarError('Business unit not found.');
    businessUnit = Number(i.business_unit_id);
  }
  let assigned: number | null = null;
  if (i.assigned_user_id) {
    if (!db.prepare('SELECT 1 FROM users WHERE id = ? AND active = 1').get(i.assigned_user_id)) throw new CalendarError('The assigned person was not found.');
    assigned = Number(i.assigned_user_id);
  }
  const privacy: Privacy = i.privacy && ['public', 'restricted', 'private'].includes(i.privacy) ? i.privacy : (financial !== 'NONE' ? 'restricted' : 'public');

  const link = clean(i.meeting_link, 500);
  if (link && !/^https?:\/\/\S+$/i.test(link)) throw new CalendarError('The meeting link must start with http:// or https://.');

  const reminders = [...new Set((i.reminders ?? []).map(Number))];
  if (reminders.length > 10) throw new CalendarError('At most 10 reminders per schedule.');
  if (reminders.some(d => !Number.isInteger(d) || d < 0 || d > 365)) throw new CalendarError('A reminder must be 0 to 365 days before.');

  const attendees = (i.attendees ?? []).map(a => ({ user_id: a.user_id ? Number(a.user_id) : null, name: clean(a.name, 120) ?? '', email: clean(a.email, 160) }));
  for (const a of attendees) {
    if (a.user_id) {
      const u = db.prepare('SELECT name FROM users WHERE id = ? AND active = 1').get(a.user_id) as { name: string } | undefined;
      if (!u) throw new CalendarError('An attendee was not found.');
      if (!a.name) a.name = u.name;
    }
    if (!a.name) throw new CalendarError('Each attendee needs a name.');
    if (a.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(a.email)) throw new CalendarError(`"${a.email}" is not a valid email address.`);
  }

  let rule: NormalizedRule | null = null;
  if (i.recurrence && i.recurrence.freq && (i.recurrence.freq as string) !== 'none') {
    const r = normalizeRule(i.recurrence, start);
    if ('error' in r) throw new CalendarError(r.error);
    rule = r.rule;
  }

  return {
    event_title: title, category, event_type: kindFor(category), financial_type: financial, business_unit_id: businessUnit, assigned_user_id: assigned,
    start_date: start, end_date: end, start_time: startTime, end_time: endTime, all_day: allDay ? 1 : 0, description: clean(i.description, 4000), privacy,
    amount, payee: financial !== 'NONE' ? clean(i.payee, 160) : null, payment_method: financial !== 'NONE' ? clean(i.payment_method, 60) : null,
    reference_no: financial !== 'NONE' ? clean(i.reference_no, 120) : null, account_bank: financial !== 'NONE' ? clean(i.account_bank, 160) : null,
    meeting_location: category === 'meeting' ? clean(i.meeting_location, 200) : null, meeting_link: category === 'meeting' ? link : null,
    attendees, reminders, rule,
  };
}

const initialStatus = (t: FinancialType) => (t === 'PAYMENT' ? 'upcoming' : t === 'COLLECTION' ? 'expected' : 'scheduled');

// ---------------- money / status ----------------
export function paidTotal(db: Database.Database, eventId: number): number {
  return round2((db.prepare('SELECT COALESCE(SUM(amount),0) s FROM calendar_event_payments WHERE event_id = ? AND voided_at IS NULL').get(eventId) as { s: number }).s);
}

// Keeps the stored status in step with the money and the date. Never touches
// the due date. Returns true when the status changed (and then writes the audit row).
export function recomputeStatus(db: Database.Database, eventId: number, today: string, actor: number | null): boolean {
  const ev = db.prepare('SELECT id, financial_type, status, start_date, amount FROM calendar_events WHERE id = ? AND deleted_at IS NULL').get(eventId) as { id: number; financial_type: FinancialType; status: string; start_date: string; amount: number | null } | undefined;
  if (!ev || ev.status === 'cancelled' || ev.financial_type === 'NONE') return false;
  const d = displayStatus({ ...ev, status: 'x' }, paidTotal(db, eventId), today);
  const collection = ev.financial_type === 'COLLECTION';
  // "due today" is derived, so it is stored as plain upcoming / expected.
  const next = d.status === 'due_today' ? 'upcoming' : d.status;
  if (next === ev.status) return false;
  db.prepare("UPDATE calendar_events SET status = ?, updated_at = datetime('now') WHERE id = ?").run(next, eventId);
  audit(db, eventId, actor, 'status_changed', `${ev.status} → ${next}${actor === null ? ' (automatic)' : ''}${collection ? '' : ''}`);
  return true;
}

// Automation: an unpaid payment past its due date becomes OVERDUE (a collection, DELAYED)
// — the original date stays exactly where it was. Cheap; safe to run on every read.
let lastSweep = '';
let lastNotify = '';
// Every write resets the throttle, so an overdue status / a new reminder shows up straight away.
export function touchCalendar() { lastSweep = ''; lastNotify = ''; }
export function sweepCalendar(db: Database.Database, today: string, force = false): number {
  const stamp = `${today}|${Math.floor(Date.now() / 30_000)}`;
  if (!force && stamp === lastSweep) return 0;
  lastSweep = stamp;
  const rows = db.prepare(`
    SELECT id FROM calendar_events
    WHERE deleted_at IS NULL AND financial_type != 'NONE' AND status IN ('upcoming','expected') AND start_date < ?
  `).all(today) as { id: number }[];
  let changed = 0;
  for (const r of rows) if (recomputeStatus(db, r.id, today, null)) changed++;
  return changed;
}

// ---------------- reads ----------------
export interface ApiEvent {
  id: number; event_title: string; event_type: string; category: string; financial_type: FinancialType;
  business_unit_id: number | null; business_unit_name: string | null; assigned_user_id: number | null; assigned_name: string | null;
  start_date: string; end_date: string; start_time: string | null; end_time: string | null; all_day: number;
  description: string | null; amount: number | null; paid: number; remaining: number; status: string; overdue: boolean; stored_status: string;
  privacy: string; meeting_location: string | null; meeting_link: string | null; recurrence_id: number | null; recurrence_text: string | null;
  original_due_date: string | null; payee: string | null; payment_method: string | null; reference_no: string | null; account_bank: string | null;
  created_by: number | null; created_by_name: string | null; created_at: string; updated_at: string; is_demo: number;
  masked?: boolean; can_edit?: boolean; can_pay?: boolean; can_update_status?: boolean; attendees?: { user_id: number | null; name: string; email: string | null }[]; reminders?: number[];
  attachment_count?: number; google?: { status: string; meet_link: string | null } | null;
}

const BASE_SQL = `
  SELECT e.*, u.name AS assigned_name, bu.name AS business_unit_name, cu.name AS created_by_name,
         COALESCE((SELECT SUM(p.amount) FROM calendar_event_payments p WHERE p.event_id = e.id AND p.voided_at IS NULL), 0) AS paid_total,
         (SELECT COUNT(*) FROM calendar_event_attachments a WHERE a.event_id = e.id AND a.deleted_at IS NULL) AS attachment_count,
         r.freq AS r_freq, r.unit AS r_unit, r.interval_count AS r_interval, r.by_weekday AS r_wd, r.by_monthday AS r_md, r.end_type AS r_end, r.until_date AS r_until, r.occurrence_count AS r_count
  FROM calendar_events e
  LEFT JOIN users u ON u.id = e.assigned_user_id
  LEFT JOIN users cu ON cu.id = e.created_by
  LEFT JOIN calendar_business_units bu ON bu.id = e.business_unit_id
  LEFT JOIN calendar_event_recurrences r ON r.id = e.recurrence_id
`;

const csvNums = (s: string | null) => (s ? s.split(',').filter(Boolean).map(Number) : []);
function ruleText(r: any): string | null {
  if (!r.r_freq) return null;
  return describeRule({ freq: r.r_freq, unit: r.r_unit, interval: r.r_interval, by_weekday: csvNums(r.r_wd), by_monthday: csvNums(r.r_md), end_type: r.r_end, until: r.r_until, count: r.r_count });
}

function attendeeMap(db: Database.Database, ids: number[]): Map<number, { user_id: number | null; name: string; email: string | null }[]> {
  const m = new Map<number, { user_id: number | null; name: string; email: string | null }[]>();
  if (!ids.length) return m;
  for (const a of db.prepare(`SELECT event_id, user_id, name, email FROM calendar_event_attendees WHERE event_id IN (${ids.map(() => '?').join(',')})`).all(...ids) as any[]) {
    (m.get(a.event_id) ?? m.set(a.event_id, []).get(a.event_id)!).push({ user_id: a.user_id, name: a.name, email: a.email });
  }
  return m;
}

function shape(row: any, c: Caps, att: { user_id: number | null; name: string; email: string | null }[], today: string, detail: boolean): ApiEvent | null {
  const level = viewLevel(c, row, att.map(a => a.user_id).filter((x): x is number => !!x));
  if (level === 'hidden') return null;
  if (level === 'masked') {
    return { id: row.id, event_title: 'Private Schedule', event_type: 'event', category: 'other', financial_type: 'NONE', business_unit_id: null, business_unit_name: null, assigned_user_id: null, assigned_name: null,
      start_date: row.start_date, end_date: row.end_date, start_time: row.start_time, end_time: row.end_time, all_day: row.all_day, description: null, amount: null, paid: 0, remaining: 0, status: 'scheduled', overdue: false, stored_status: 'scheduled',
      privacy: 'private', meeting_location: null, meeting_link: null, recurrence_id: null, recurrence_text: null, original_due_date: null, payee: null, payment_method: null, reference_no: null, account_bank: null,
      created_by: null, created_by_name: null, created_at: row.created_at, updated_at: row.updated_at, is_demo: row.is_demo, masked: true, can_edit: false, can_pay: false, can_update_status: false };
  }
  const d = displayStatus({ financial_type: row.financial_type, status: row.status, start_date: row.start_date, amount: row.amount }, row.paid_total, today);
  const manage = canManageFinancial(c, row.category);
  const out: ApiEvent = {
    id: row.id, event_title: row.event_title, event_type: row.event_type, category: row.category, financial_type: row.financial_type,
    business_unit_id: row.business_unit_id, business_unit_name: row.business_unit_name, assigned_user_id: row.assigned_user_id, assigned_name: row.assigned_name,
    start_date: row.start_date, end_date: row.end_date, start_time: row.start_time, end_time: row.end_time, all_day: row.all_day,
    description: row.description, amount: row.amount, paid: round2(row.paid_total), remaining: d.remaining, status: d.status, overdue: d.overdue, stored_status: row.status,
    privacy: row.privacy, meeting_location: row.meeting_location, meeting_link: row.meeting_link, recurrence_id: row.recurrence_id, recurrence_text: ruleText(row),
    original_due_date: row.original_due_date, payee: row.payee, payment_method: row.payment_method, reference_no: row.reference_no, account_bank: row.account_bank,
    created_by: row.created_by, created_by_name: row.created_by_name, created_at: row.created_at, updated_at: row.updated_at, is_demo: row.is_demo,
    can_edit: canEditEvent(c, row), can_pay: row.financial_type !== 'NONE' && manage && row.status !== 'cancelled',
    can_update_status: canEditEvent(c, row) || row.assigned_user_id === c.userId, attachment_count: row.attachment_count,
  };
  if (detail) out.attendees = att;
  return out;
}

export interface ListFilters {
  from: string; to: string; q?: string; business_unit_id?: number | null; category?: string | null; status?: string | null; assigned_to?: number | null;
  financial_only?: boolean; meetings_only?: boolean; overdue_only?: boolean;
}

export function listEvents(db: Database.Database, c: Caps, f: ListFilters, today: string): ApiEvent[] {
  extendSeriesThrough(db, f.to, today);
  const rows = db.prepare(`${BASE_SQL} WHERE e.deleted_at IS NULL AND e.start_date <= ? AND e.end_date >= ? ORDER BY e.start_date, COALESCE(e.start_time, ''), e.id`).all(f.to, f.from) as any[];
  const att = attendeeMap(db, rows.map(r => r.id));
  const q = (f.q ?? '').trim().toLowerCase();
  const out: ApiEvent[] = [];
  for (const row of rows) {
    const ev = shape(row, c, att.get(row.id) ?? [], today, false);
    if (!ev) continue;
    if (ev.masked) { if (!q && !f.business_unit_id && !f.category && !f.status && !f.assigned_to && !f.financial_only && !f.meetings_only && !f.overdue_only) out.push(ev); continue; }
    if (f.business_unit_id && ev.business_unit_id !== f.business_unit_id) continue;
    if (f.category && ev.category !== f.category) continue;
    if (f.status && ev.status !== f.status && !(f.status === 'overdue' && ev.overdue)) continue;
    if (f.assigned_to && ev.assigned_user_id !== f.assigned_to) continue;
    if (f.financial_only && ev.financial_type === 'NONE') continue;
    if (f.meetings_only && ev.event_type !== 'meeting') continue;
    if (f.overdue_only && !ev.overdue) continue;
    if (q) {
      const hay = [ev.event_title, ev.payee, ev.reference_no, ev.description, ev.assigned_name, ev.business_unit_name, ev.account_bank, ev.meeting_location, ev.created_by_name, ...(att.get(row.id) ?? []).map(a => a.name)].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) continue;
    }
    out.push(ev);
  }
  return out;
}

export function getEventDetail(db: Database.Database, c: Caps, id: number, today: string) {
  const row = db.prepare(`${BASE_SQL} WHERE e.id = ? AND e.deleted_at IS NULL`).get(id) as any;
  if (!row) throw new CalendarError('Schedule not found.', 404);
  const att = attendeeMap(db, [id]).get(id) ?? [];
  const ev = shape(row, c, att, today, true);
  if (!ev) throw new CalendarError('Schedule not found.', 404); // never confirm that a hidden one exists
  if (ev.masked) return { event: ev, payments: [], attachments: [], audit: [], reminders: [], google: null };
  const master = row.recurrence_id ? ((db.prepare('SELECT master_event_id m FROM calendar_event_recurrences WHERE id = ?').get(row.recurrence_id) as { m: number | null } | undefined)?.m ?? id) : id;
  ev.reminders = (db.prepare('SELECT days_before FROM calendar_event_reminders WHERE event_id = ? ORDER BY days_before DESC').all(master) as { days_before: number }[]).map(r => r.days_before);
  const payments = db.prepare(`SELECT p.*, u.name AS recorded_by_name FROM calendar_event_payments p LEFT JOIN users u ON u.id = p.recorded_by WHERE p.event_id = ? ORDER BY p.payment_date, p.id`).all(id);
  const attachments = db.prepare(`SELECT a.id, a.payment_id, a.kind, a.original_name, a.mime_type, a.size_bytes, a.created_at, u.name AS uploaded_by_name FROM calendar_event_attachments a LEFT JOIN users u ON u.id = a.uploaded_by WHERE a.event_id = ? AND a.deleted_at IS NULL ORDER BY a.id`).all(id);
  const auditRows = db.prepare(`SELECT l.action, l.details, l.created_at, u.name AS actor_name FROM calendar_event_audit_logs l LEFT JOIN users u ON u.id = l.actor_user_id WHERE l.event_id = ? ORDER BY l.id DESC`).all(id);
  const google = db.prepare('SELECT sync_status AS status, meet_link, last_error FROM calendar_google_sync WHERE event_id = ?').get(id) ?? null;
  return { event: ev, payments, attachments, audit: auditRows, google };
}

// ---------------- writes ----------------
function insertEventRow(db: Database.Database, v: Cleaned, actor: number, extra: { recurrence_id?: number | null; occurrence_date?: string | null; demo?: boolean } = {}): number {
  const info = db.prepare(`
    INSERT INTO calendar_events (event_title, event_type, category, business_unit_id, assigned_user_id, start_date, end_date, start_time, end_time, all_day, description,
      financial_type, amount, payee, payment_method, reference_no, account_bank, status, original_due_date, privacy, meeting_location, meeting_link, recurrence_id, occurrence_date, is_demo, created_by, updated_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?, ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(v.event_title, v.event_type, v.category, v.business_unit_id, v.assigned_user_id, v.start_date, v.end_date, v.start_time, v.end_time, v.all_day, v.description,
    v.financial_type, v.amount, v.payee, v.payment_method, v.reference_no, v.account_bank, initialStatus(v.financial_type), v.start_date, v.privacy, v.meeting_location, v.meeting_link,
    extra.recurrence_id ?? null, extra.occurrence_date ?? null, extra.demo ? 1 : 0, actor, actor);
  return Number(info.lastInsertRowid);
}
function setChildren(db: Database.Database, id: number, v: Pick<Cleaned, 'attendees'>, reminders?: number[]) {
  db.prepare('DELETE FROM calendar_event_attendees WHERE event_id = ?').run(id);
  for (const a of v.attendees) db.prepare('INSERT INTO calendar_event_attendees (event_id, user_id, name, email) VALUES (?,?,?,?)').run(id, a.user_id, a.name, a.email);
  if (reminders) {
    db.prepare('DELETE FROM calendar_event_reminders WHERE event_id = ?').run(id);
    for (const d of reminders) db.prepare('INSERT INTO calendar_event_reminders (event_id, days_before) VALUES (?,?)').run(id, d);
  }
}
const shiftEnd = (start: string, end: string, newStart: string) => addDays(newStart, daysBetween(start, end));

// A series keeps a rule; each occurrence is its own row so it can be paid / cancelled on its own.
function insertRecurrence(db: Database.Database, rule: NormalizedRule, startDate: string, actor: number): number {
  const info = db.prepare(`
    INSERT INTO calendar_event_recurrences (freq, unit, interval_count, by_weekday, by_monthday, end_type, until_date, occurrence_count, start_date, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(rule.freq, rule.unit, rule.interval, rule.by_weekday.join(','), rule.by_monthday.join(','), rule.end_type, rule.until, rule.count, startDate, actor);
  return Number(info.lastInsertRowid);
}
const ruleOf = (r: any): NormalizedRule => ({ freq: r.freq, unit: r.unit, interval: r.interval_count, by_weekday: csvNums(r.by_weekday), by_monthday: csvNums(r.by_monthday), end_type: r.end_type, until: r.until_date, count: r.occurrence_count });

// Creates the missing occurrence rows of a series up to `through`. Past dates are not
// created for a series that already exists (they would all appear overdue at once).
function materialize(db: Database.Database, recurrenceId: number, through: string, today: string) {
  const rec = db.prepare('SELECT * FROM calendar_event_recurrences WHERE id = ? AND deleted_at IS NULL').get(recurrenceId) as any;
  if (!rec || !rec.master_event_id) return;
  const master = db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(rec.master_event_id) as any;
  if (!master) return;
  const dates = expandRule(ruleOf(rec), rec.start_date, through);
  const have = new Set((db.prepare('SELECT occurrence_date d FROM calendar_event_recurrences r JOIN calendar_events e ON e.recurrence_id = r.id WHERE r.id = ?').all(recurrenceId) as { d: string }[]).map(x => x.d));
  const attendees = db.prepare('SELECT user_id, name, email FROM calendar_event_attendees WHERE event_id = ?').all(master.id) as { user_id: number | null; name: string; email: string | null }[];
  for (const d of dates) {
    if (have.has(d) || (d < today && d !== rec.start_date)) continue;
    const v: Cleaned = {
      event_title: master.event_title, category: master.category, event_type: master.event_type, financial_type: master.financial_type, business_unit_id: master.business_unit_id, assigned_user_id: master.assigned_user_id,
      start_date: d, end_date: shiftEnd(master.start_date, master.end_date, d), start_time: master.start_time, end_time: master.end_time, all_day: master.all_day, description: master.description, privacy: master.privacy,
      amount: master.amount, payee: master.payee, payment_method: master.payment_method, reference_no: master.reference_no, account_bank: master.account_bank,
      meeting_location: master.meeting_location, meeting_link: master.meeting_link, attendees, reminders: [], rule: null,
    };
    const id = insertEventRow(db, v, master.created_by ?? 0, { recurrence_id: recurrenceId, occurrence_date: d, demo: !!master.is_demo });
    db.prepare("UPDATE calendar_events SET created_by = ? WHERE id = ?").run(master.created_by, id);
    setChildren(db, id, v);
  }
  db.prepare('UPDATE calendar_event_recurrences SET generated_until = ? WHERE id = ?').run(through, recurrenceId);
}

export function extendSeriesThrough(db: Database.Database, through: string, today: string) {
  const cap = addDays(today, 365 * 5);
  const target = through > cap ? cap : through;
  const recs = db.prepare(`SELECT id FROM calendar_event_recurrences WHERE deleted_at IS NULL AND master_event_id IS NOT NULL AND (generated_until IS NULL OR generated_until < ?)`).all(target) as { id: number }[];
  for (const r of recs) materialize(db, r.id, target, today);
}

export function createEvent(db: Database.Database, c: Caps, input: EventInput, today: string, opts: { demo?: boolean } = {}): number {
  const v = cleanInput(db, input);
  if (v.financial_type !== 'NONE' && !canManageFinancial(c, v.category)) throw new CalendarError('Only Finance or the Owner can schedule payments and collections.', 403);
  let id = 0;
  db.transaction(() => {
    let recurrenceId: number | null = null;
    if (v.rule) recurrenceId = insertRecurrence(db, v.rule, v.start_date, c.userId);
    id = insertEventRow(db, v, c.userId, { recurrence_id: recurrenceId, occurrence_date: recurrenceId ? v.start_date : null, demo: opts.demo });
    const reminders = v.reminders;
    setChildren(db, id, v, reminders);
    audit(db, id, c.userId, 'created', `${v.event_title}${v.amount ? ` — ₱${v.amount.toFixed(2)}` : ''}`);
    if (recurrenceId) {
      db.prepare('UPDATE calendar_event_recurrences SET master_event_id = ? WHERE id = ?').run(id, recurrenceId);
      materialize(db, recurrenceId, addDays(today > v.start_date ? today : v.start_date, 366), today);
    }
  })();
  recomputeStatus(db, id, today, null);
  touchCalendar();
  return id;
}

type Scope = 'this' | 'future' | 'all';
function scopeIds(db: Database.Database, ev: any, scope: Scope): number[] {
  if (!ev.recurrence_id || scope === 'this') return [ev.id];
  const rows = db.prepare(`SELECT id FROM calendar_events WHERE recurrence_id = ? AND deleted_at IS NULL ${scope === 'future' ? 'AND occurrence_date >= ?' : ''} ORDER BY occurrence_date`)
    .all(...(scope === 'future' ? [ev.recurrence_id, ev.occurrence_date] : [ev.recurrence_id])) as { id: number }[];
  return rows.map(r => r.id);
}
const loadEvent = (db: Database.Database, id: number) => {
  const ev = db.prepare('SELECT * FROM calendar_events WHERE id = ? AND deleted_at IS NULL').get(id) as any;
  if (!ev) throw new CalendarError('Schedule not found.', 404);
  return ev;
};
function attendeeIds(db: Database.Database, id: number) { return (db.prepare('SELECT user_id FROM calendar_event_attendees WHERE event_id = ? AND user_id IS NOT NULL').all(id) as { user_id: number }[]).map(r => r.user_id); }
function requireEdit(db: Database.Database, c: Caps, ev: any) {
  if (viewLevel(c, ev, attendeeIds(db, ev.id)) !== 'full') throw new CalendarError('Schedule not found.', 404);
  if (!canEditEvent(c, ev)) throw new CalendarError('You do not have permission to change this schedule.', 403);
}

export function updateEvent(db: Database.Database, c: Caps, id: number, input: EventInput, scope: Scope, today: string) {
  const ev = loadEvent(db, id);
  requireEdit(db, c, ev);
  // Moving the date without saying anything about the end date keeps the same length.
  const moved: EventInput = input.start_date && !input.end_date && isISODate(input.start_date) ? { ...input, end_date: shiftEnd(ev.start_date, ev.end_date, input.start_date) } : input;
  const merged: EventInput = { ...ev, ...moved, all_day: input.all_day ?? !!ev.all_day, attendees: input.attendees ?? undefined, reminders: input.reminders ?? undefined, recurrence: undefined };
  const v = cleanInput(db, { ...merged, attendees: input.attendees ?? (db.prepare('SELECT user_id, name, email FROM calendar_event_attendees WHERE event_id = ?').all(id) as any[]) }, { start_date: ev.start_date, end_date: ev.end_date, category: ev.category });
  if (v.financial_type !== 'NONE' && !canManageFinancial(c, v.category)) throw new CalendarError('Only Finance or the Owner can schedule payments and collections.', 403);
  if (v.financial_type !== ev.financial_type) throw new CalendarError('The kind of schedule (payment / collection / other) cannot be changed. Create a new schedule instead.');
  const targets = scopeIds(db, ev, ev.recurrence_id ? scope : 'this');
  const master = ev.recurrence_id ? ((db.prepare('SELECT master_event_id m FROM calendar_event_recurrences WHERE id = ?').get(ev.recurrence_id) as any)?.m ?? ev.id) : ev.id;

  let newRule: NormalizedRule | null = null;
  if (input.recurrence && (input.recurrence as any).freq && (input.recurrence as any).freq !== 'none') {
    const r = normalizeRule(input.recurrence, ev.start_date);
    if ('error' in r) throw new CalendarError(r.error);
    newRule = r.rule;
    if (ev.recurrence_id && scope === 'this') throw new CalendarError('To change how it repeats, apply the change to "this and following" or "all" schedules.');
  }

  db.transaction(() => {
    for (const tid of targets) {
      const t = db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(tid) as any;
      const hasPayments = paidTotal(db, tid) > 0;
      const isThis = tid === id;
      // A paid / part-paid occurrence keeps its own amount; dates only move for the one being edited.
      const amount = v.financial_type === 'NONE' ? null : (hasPayments && !isThis ? t.amount : v.amount);
      if (v.financial_type !== 'NONE' && amount !== null && paidTotal(db, tid) > amount + 0.005) throw new CalendarError('The amount cannot be lower than what has already been paid.');
      const start = isThis ? v.start_date : t.start_date;
      const end = isThis ? v.end_date : shiftEnd(t.start_date, t.end_date, t.start_date);
      db.prepare(`
        UPDATE calendar_events SET event_title=?, event_type=?, category=?, business_unit_id=?, assigned_user_id=?, start_date=?, end_date=?, start_time=?, end_time=?, all_day=?, description=?,
          amount=?, payee=?, payment_method=?, reference_no=?, account_bank=?, privacy=?, meeting_location=?, meeting_link=?, updated_by=?, updated_at=datetime('now') WHERE id=?
      `).run(v.event_title, v.event_type, v.category, v.business_unit_id, v.assigned_user_id, start, end, v.start_time, v.end_time, v.all_day, v.description,
        amount, v.payee, v.payment_method, v.reference_no, v.account_bank, v.privacy, v.meeting_location, v.meeting_link, c.userId, tid);
      if (input.attendees) setChildren(db, tid, v);
      const moved = t.start_date !== start;
      audit(db, tid, c.userId, 'updated', `${isThis ? 'Edited' : 'Edited with the series'}${moved ? `; date moved ${t.start_date} → ${start} (original due date ${t.original_due_date ?? t.start_date} kept)` : ''}`);
      recomputeStatus(db, tid, today, c.userId);
    }
    if (input.reminders) setChildren(db, master, { attendees: attendeesOf(db, master) }, v.reminders);
    if (newRule && ev.recurrence_id) splitSeries(db, c, ev, scope, newRule, today);
  })();
}
const attendeesOf = (db: Database.Database, id: number) => db.prepare('SELECT user_id, name, email FROM calendar_event_attendees WHERE event_id = ?').all(id) as { user_id: number | null; name: string; email: string | null }[];

// Changing HOW a series repeats: the untouched future occurrences are replaced by
// a new series from this date; anything already paid / cancelled stays as it was.
function splitSeries(db: Database.Database, c: Caps, ev: any, scope: Scope, rule: NormalizedRule, today: string) {
  const from = scope === 'all' ? (db.prepare('SELECT MIN(occurrence_date) d FROM calendar_events WHERE recurrence_id = ? AND deleted_at IS NULL').get(ev.recurrence_id) as any).d : ev.occurrence_date;
  const old = db.prepare('SELECT * FROM calendar_event_recurrences WHERE id = ?').get(ev.recurrence_id) as any;
  const later = db.prepare(`SELECT id, status FROM calendar_events WHERE recurrence_id = ? AND deleted_at IS NULL AND occurrence_date >= ? AND id != ?`).all(ev.recurrence_id, from, ev.id) as { id: number; status: string }[];
  for (const l of later) {
    if (paidTotal(db, l.id) > 0 || l.status === 'cancelled') continue;
    db.prepare("UPDATE calendar_events SET deleted_at = datetime('now'), deleted_by = ? WHERE id = ?").run(c.userId, l.id);
    audit(db, l.id, c.userId, 'deleted', 'Replaced when the repeat rule was changed');
  }
  if (from > old.start_date) db.prepare('UPDATE calendar_event_recurrences SET until_date = ?, end_type = ? WHERE id = ?').run(addDays(from, -1), 'until', ev.recurrence_id);
  const rid = insertRecurrence(db, { ...rule, end_type: rule.end_type }, ev.start_date, c.userId);
  db.prepare('UPDATE calendar_events SET recurrence_id = ?, occurrence_date = ? WHERE id = ?').run(rid, ev.start_date, ev.id);
  db.prepare('UPDATE calendar_event_recurrences SET master_event_id = ? WHERE id = ?').run(ev.id, rid);
  if (from <= old.start_date) db.prepare("UPDATE calendar_event_recurrences SET deleted_at = datetime('now') WHERE id = ?").run(ev.recurrence_id);
  audit(db, ev.id, c.userId, 'updated', `Repeat changed: ${describeRule(rule)}`);
  materialize(db, rid, addDays(today > ev.start_date ? today : ev.start_date, 366), today);
}

export function deleteEvent(db: Database.Database, c: Caps, id: number, scope: Scope, today: string): { deleted: number; kept: number } {
  const ev = loadEvent(db, id);
  requireEdit(db, c, ev);
  const ids = scopeIds(db, ev, ev.recurrence_id ? scope : 'this');
  if (!ev.recurrence_id || scope === 'this') {
    if (paidTotal(db, id) > 0) throw new CalendarError('Payments were already recorded on this schedule. Cancel it instead, so the history is kept.', 409);
  }
  let deleted = 0, kept = 0;
  db.transaction(() => {
    for (const tid of ids) {
      if (paidTotal(db, tid) > 0) { kept++; continue; }
      db.prepare("UPDATE calendar_events SET deleted_at = datetime('now'), deleted_by = ?, updated_at = datetime('now') WHERE id = ?").run(c.userId, tid);
      audit(db, tid, c.userId, 'deleted', scope === 'this' || !ev.recurrence_id ? 'Deleted' : `Deleted (${scope === 'all' ? 'entire series' : 'this and following'})`);
      deleted++;
    }
    if (ev.recurrence_id && scope !== 'this') {
      if (scope === 'all') db.prepare("UPDATE calendar_event_recurrences SET deleted_at = datetime('now') WHERE id = ?").run(ev.recurrence_id);
      else db.prepare("UPDATE calendar_event_recurrences SET end_type = 'until', until_date = ? WHERE id = ?").run(addDays(ev.occurrence_date, -1), ev.recurrence_id);
    }
  })();
  void today;
  return { deleted, kept };
}

export function cancelEvent(db: Database.Database, c: Caps, id: number, cancel: boolean, reason: string | null, today: string) {
  const ev = loadEvent(db, id);
  if (viewLevel(c, ev, attendeeIds(db, id)) !== 'full') throw new CalendarError('Schedule not found.', 404);
  if (!canEditEvent(c, ev)) throw new CalendarError('You do not have permission to change this schedule.', 403);
  db.transaction(() => {
    if (cancel) {
      db.prepare("UPDATE calendar_events SET status = 'cancelled', cancelled_at = datetime('now'), cancel_reason = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?").run(reason, c.userId, id);
      audit(db, id, c.userId, 'cancelled', reason || 'Cancelled');
    } else {
      db.prepare("UPDATE calendar_events SET status = ?, cancelled_at = NULL, cancel_reason = NULL, updated_by = ?, updated_at = datetime('now') WHERE id = ?").run(initialStatus(ev.financial_type), c.userId, id);
      audit(db, id, c.userId, 'restored', 'Cancellation undone');
      recomputeStatus(db, id, today, c.userId);
    }
  })();
}

export function completeEvent(db: Database.Database, c: Caps, id: number, done: boolean) {
  const ev = loadEvent(db, id);
  if (ev.financial_type !== 'NONE') throw new CalendarError('Record a payment to complete a payment or collection.');
  if (viewLevel(c, ev, attendeeIds(db, id)) !== 'full') throw new CalendarError('Schedule not found.', 404);
  if (!(canEditEvent(c, ev) || ev.assigned_user_id === c.userId)) throw new CalendarError('You do not have permission to change this schedule.', 403);
  if (ev.status === 'cancelled') throw new CalendarError('This schedule is cancelled.', 409);
  db.prepare("UPDATE calendar_events SET status = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?").run(done ? 'completed' : 'scheduled', c.userId, id);
  audit(db, id, c.userId, 'status_changed', done ? 'scheduled → completed' : 'completed → scheduled');
}

export function duplicateEvent(db: Database.Database, c: Caps, id: number, today: string): number {
  const ev = loadEvent(db, id);
  if (viewLevel(c, ev, attendeeIds(db, id)) !== 'full') throw new CalendarError('Schedule not found.', 404);
  const input: EventInput = {
    event_title: `${ev.event_title} (copy)`, category: ev.category, business_unit_id: ev.business_unit_id, assigned_user_id: ev.assigned_user_id, start_date: ev.start_date, end_date: ev.end_date,
    start_time: ev.start_time, end_time: ev.end_time, all_day: !!ev.all_day, description: ev.description, privacy: ev.privacy, financial_type: ev.financial_type, amount: ev.amount,
    payee: ev.payee, payment_method: ev.payment_method, reference_no: null, account_bank: ev.account_bank, meeting_location: ev.meeting_location, meeting_link: ev.meeting_link,
    attendees: attendeesOf(db, id), reminders: (db.prepare('SELECT days_before FROM calendar_event_reminders WHERE event_id = ?').all(id) as { days_before: number }[]).map(r => r.days_before),
  };
  const newId = createEvent(db, c, input, today);
  audit(db, newId, c.userId, 'created', `Duplicated from schedule #${id}`);
  return newId;
}

// ---------------- payments ----------------
export interface PaymentInput { payment_date?: string; amount?: number; payment_method?: string | null; reference_no?: string | null; remarks?: string | null; mark_as_paid?: boolean }
export function addPayment(db: Database.Database, c: Caps, id: number, input: PaymentInput, today: string): { payment_id: number; status: string; remaining: number } {
  const ev = loadEvent(db, id);
  if (viewLevel(c, ev, attendeeIds(db, id)) !== 'full') throw new CalendarError('Schedule not found.', 404);
  if (ev.financial_type === 'NONE') throw new CalendarError('This schedule has no amount to pay.');
  if (!canManageFinancial(c, ev.category)) throw new CalendarError('Only Finance or the Owner can record payments.', 403);
  if (ev.status === 'cancelled') throw new CalendarError('This schedule is cancelled. Restore it first.', 409);
  const word = ev.financial_type === 'COLLECTION' ? 'collection' : 'payment';
  if (!isISODate(input.payment_date)) throw new CalendarError(`The ${word} date is not a valid date.`);
  if (input.payment_date > today) throw new CalendarError(`The ${word} date cannot be in the future.`);
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new CalendarError('Amount must be more than ₱0.');
  const paid = paidTotal(db, id);
  const remaining = round2((ev.amount ?? 0) - paid);
  if (remaining <= 0.005) throw new CalendarError(`This ${word === 'payment' ? 'schedule is already fully paid' : 'collection was already fully received'}.`, 409);
  if (round2(amount) > remaining + 0.005) throw new CalendarError(`That is more than the remaining balance of ₱${remaining.toFixed(2)}.`);
  if (input.mark_as_paid && round2(amount) < remaining - 0.005) throw new CalendarError(`That does not cover the full balance of ₱${remaining.toFixed(2)}. Record it as a partial payment instead.`);
  let pid = 0;
  db.transaction(() => {
    pid = Number(db.prepare('INSERT INTO calendar_event_payments (event_id, payment_date, amount, payment_method, reference_no, remarks, recorded_by) VALUES (?,?,?,?,?,?,?)')
      .run(id, input.payment_date, round2(amount), clean(input.payment_method, 60), clean(input.reference_no, 120), clean(input.remarks, 1000), c.userId).lastInsertRowid);
    audit(db, id, c.userId, 'payment_recorded', `₱${round2(amount).toFixed(2)} ${word} on ${input.payment_date}${clean(input.payment_method, 60) ? ` via ${clean(input.payment_method, 60)}` : ''}${clean(input.reference_no, 120) ? ` ref ${clean(input.reference_no, 120)}` : ''}`);
    db.prepare("UPDATE calendar_events SET updated_by = ?, updated_at = datetime('now') WHERE id = ?").run(c.userId, id);
    recomputeStatus(db, id, today, c.userId);
  })();
  const after = paidTotal(db, id);
  return { payment_id: pid, status: displayStatus({ financial_type: ev.financial_type, status: 'x', start_date: ev.start_date, amount: ev.amount }, after, today).status, remaining: round2((ev.amount ?? 0) - after) };
}

export function voidPayment(db: Database.Database, c: Caps, id: number, paymentId: number, reason: string | null, today: string) {
  const ev = loadEvent(db, id);
  if (viewLevel(c, ev, attendeeIds(db, id)) !== 'full') throw new CalendarError('Schedule not found.', 404);
  if (!canManageFinancial(c, ev.category)) throw new CalendarError('Only Finance or the Owner can change payments.', 403);
  const p = db.prepare('SELECT * FROM calendar_event_payments WHERE id = ? AND event_id = ?').get(paymentId, id) as any;
  if (!p) throw new CalendarError('Payment not found.', 404);
  if (p.voided_at) throw new CalendarError('This payment was already voided.', 409);
  const why = clean(reason, 300);
  if (!why) throw new CalendarError('Give a reason for voiding this payment.');
  db.transaction(() => {
    db.prepare("UPDATE calendar_event_payments SET voided_at = datetime('now'), voided_by = ?, void_reason = ? WHERE id = ?").run(c.userId, why, paymentId);
    audit(db, id, c.userId, 'payment_voided', `₱${Number(p.amount).toFixed(2)} payment of ${p.payment_date} voided: ${why}`);
    recomputeStatus(db, id, today, c.userId);
  })();
}

// ---------------- attachments (rows only; files are handled by the route) ----------------
export function attachmentAccess(db: Database.Database, c: Caps, attachmentId: number) {
  const a = db.prepare('SELECT * FROM calendar_event_attachments WHERE id = ? AND deleted_at IS NULL').get(attachmentId) as any;
  if (!a) return null;
  const ev = db.prepare('SELECT * FROM calendar_events WHERE id = ? AND deleted_at IS NULL').get(a.event_id) as any;
  if (!ev || viewLevel(c, ev, attendeeIds(db, ev.id)) !== 'full') return null;
  return { attachment: a, event: ev, canDelete: canEditEvent(c, ev) || canManageFinancial(c, ev.category) };
}
export function assertCanAttach(db: Database.Database, c: Caps, eventId: number) {
  const ev = loadEvent(db, eventId);
  if (viewLevel(c, ev, attendeeIds(db, eventId)) !== 'full') throw new CalendarError('Schedule not found.', 404);
  if (!(canEditEvent(c, ev) || canManageFinancial(c, ev.category) || ev.assigned_user_id === c.userId)) throw new CalendarError('You do not have permission to add files here.', 403);
  return ev;
}

// ---------------- summaries ----------------
export function monthSummary(db: Database.Database, c: Caps, ym: string, today: string) {
  const { from, to } = monthBounds(ym);
  const events = listEvents(db, c, { from, to, financial_only: true }, today).filter(e => e.start_date >= from && e.start_date <= to && e.status !== 'cancelled');
  const sum = (a: ApiEvent[], f: (e: ApiEvent) => number) => round2(a.reduce((s, e) => s + f(e), 0));
  const pay = events.filter(e => e.financial_type === 'PAYMENT'), col = events.filter(e => e.financial_type === 'COLLECTION');
  const upcoming = sum(pay.filter(e => !e.overdue), e => e.remaining), overdue = sum(pay.filter(e => e.overdue), e => e.remaining);
  const expected = sum(col, e => e.remaining), received = sum(col, e => e.paid);
  const paymentsTotal = sum(pay, e => e.amount ?? 0), collectionsTotal = sum(col, e => e.amount ?? 0);
  return {
    month: ym, upcoming_payments: upcoming, paid: sum(pay, e => e.paid), overdue, expected_collections: expected, received_collections: received,
    delayed_collections: sum(col.filter(e => e.overdue), e => e.remaining),
    // Expected Collections minus what still has to go out (upcoming + overdue payments); cancelled items are never counted.
    scheduled_net_cash_flow: round2(expected - upcoming - overdue),
    cash_flow: { scheduled_collections: collectionsTotal, scheduled_payments: paymentsTotal, projected: round2(collectionsTotal - paymentsTotal) },
    counts: { payments: pay.length, collections: col.length, overdue: pay.filter(e => e.overdue).length },
  };
}

const PRIORITY: Record<string, number> = { payment_due: 3, supplier_payment: 3, loan_payment: 3, bills_utilities: 3, expected_collection: 4, meeting: 5, payroll: 6, deadline: 7 };
export function upcoming(db: Database.Database, c: Caps, today: string, days = 7) {
  const to = addDays(today, days - 1);
  const week = listEvents(db, c, { from: today, to }, today).filter(e => e.status !== 'cancelled' && e.status !== 'paid' && e.status !== 'received' && e.status !== 'completed' && !e.masked);
  const overdueAll = listEvents(db, c, { from: addDays(today, -365), to: addDays(today, -1), financial_only: true, overdue_only: true }, today).filter(e => e.status !== 'cancelled');
  const todayEvents = listEvents(db, c, { from: today, to: today }, today).filter(e => e.status !== 'cancelled');
  const group = (e: ApiEvent) => (e.event_type === 'meeting' ? 'meetings' : e.financial_type === 'PAYMENT' ? 'payments' : e.financial_type === 'COLLECTION' ? 'collections' : 'tasks');
  const todayGroups: Record<string, ApiEvent[]> = { meetings: [], payments: [], collections: [], tasks: [] };
  for (const e of todayEvents) todayGroups[group(e)].push(e);
  // Dashboard priority: overdue payments first, then due today, then the rest by kind and date.
  const rank = (e: ApiEvent) => (e.overdue && e.financial_type === 'PAYMENT' ? 0 : e.start_date === today && e.financial_type === 'PAYMENT' ? 1 : e.overdue ? 2 : PRIORITY[e.category] ?? 8);
  const priority = [...overdueAll, ...week.filter(w => !overdueAll.some(o => o.id === w.id))].sort((a, b) => rank(a) - rank(b) || a.start_date.localeCompare(b.start_date) || (a.start_time ?? '').localeCompare(b.start_time ?? ''));
  return { today, week, overdue: overdueAll.sort((a, b) => a.start_date.localeCompare(b.start_date)), today_groups: todayGroups, priority: priority.slice(0, 10) };
}

// ---------------- reminders → in-app notifications ----------------
function recipientsFor(db: Database.Database, ev: any): number[] {
  const ids = new Set<number>();
  if (ev.assigned_user_id) ids.add(ev.assigned_user_id);
  if (ev.created_by) ids.add(ev.created_by);
  for (const r of db.prepare(`SELECT id FROM users WHERE active = 1 AND role = 'owner'`).all() as { id: number }[]) ids.add(r.id);
  if (ev.financial_type !== 'NONE') {
    for (const r of db.prepare(`SELECT DISTINCT user_id id FROM user_permissions WHERE module = 'calendar_finance'`).all() as { id: number }[]) ids.add(r.id);
    if (ev.category === 'payroll') for (const r of db.prepare(`SELECT DISTINCT user_id id FROM user_permissions WHERE module = 'payroll'`).all() as { id: number }[]) ids.add(r.id);
  }
  for (const id of attendeeIds(db, ev.id)) ids.add(id);
  return [...ids];
}

// Raises the alerts that are due today (and one "overdue" alert per unpaid item).
// Idempotent: UNIQUE(user, event, kind, day) means running it again does nothing.
export function generateNotifications(db: Database.Database, today: string, force = false): number {
  const stamp = `${today}|${Math.floor(Date.now() / 30_000)}`;
  if (!force && stamp === lastNotify) return 0;
  lastNotify = stamp;
  const ins = db.prepare('INSERT OR IGNORE INTO calendar_notifications (user_id, event_id, kind, title, fire_date) VALUES (?,?,?,?,?)');
  let created = 0;
  const open = db.prepare(`
    SELECT e.*, COALESCE((SELECT SUM(p.amount) FROM calendar_event_payments p WHERE p.event_id = e.id AND p.voided_at IS NULL),0) AS paid_total,
           COALESCE((SELECT r.master_event_id FROM calendar_event_recurrences r WHERE r.id = e.recurrence_id), e.id) AS master_id
    FROM calendar_events e
    WHERE e.deleted_at IS NULL AND e.status != 'cancelled' AND e.status != 'completed' AND e.start_date >= ? AND e.start_date <= ?
  `).all(addDays(today, -1), addDays(today, 30)) as any[];
  for (const ev of open) {
    if (ev.financial_type !== 'NONE' && (ev.amount ?? 0) - ev.paid_total <= 0.005) continue;
    const days = db.prepare('SELECT days_before FROM calendar_event_reminders WHERE event_id = ?').all(ev.master_id) as { days_before: number }[];
    const left = daysBetween(today, ev.start_date);
    for (const { days_before } of days) {
      if (left < 0 || left > days_before) continue; // not yet time, or already past
      const title = reminderHeadline(ev, left);
      for (const uid of recipientsFor(db, ev)) created += ins.run(uid, ev.id, `reminder_${days_before}`, title, addDays(ev.start_date, -days_before)).changes;
    }
  }
  const overdue = db.prepare(`SELECT e.*, COALESCE((SELECT SUM(p.amount) FROM calendar_event_payments p WHERE p.event_id = e.id AND p.voided_at IS NULL),0) AS paid_total
    FROM calendar_events e WHERE e.deleted_at IS NULL AND e.financial_type = 'PAYMENT' AND e.status IN ('overdue','partially_paid','upcoming') AND e.start_date < ? AND e.start_date >= ?`).all(today, addDays(today, -60)) as any[];
  for (const ev of overdue) {
    if ((ev.amount ?? 0) - ev.paid_total <= 0.005) continue;
    for (const uid of recipientsFor(db, ev)) created += ins.run(uid, ev.id, 'overdue', reminderHeadline(ev, -1), ev.start_date).changes;
  }
  return created;
}

export function notificationsFor(db: Database.Database, c: Caps, today: string) {
  const rows = db.prepare(`
    SELECT n.id, n.event_id, n.kind, n.title, n.fire_date, n.read_at, n.created_at FROM calendar_notifications n
    WHERE n.user_id = ? AND n.fire_date <= ? ORDER BY n.read_at IS NOT NULL, n.created_at DESC, n.id DESC LIMIT 60
  `).all(c.userId, today) as any[];
  const out: any[] = [];
  for (const n of rows) {
    let detail: ApiEvent | null = null;
    try { detail = getEventDetail(db, c, n.event_id, today).event; } catch { continue; } // deleted or no longer visible
    if (!detail || detail.masked) continue;
    if (detail.status === 'cancelled') continue;
    // stale: paid since the alert was raised
    if (['paid', 'received', 'completed'].includes(detail.status)) continue;
    out.push({ id: n.id, event_id: n.event_id, kind: n.kind, title: n.title, read: !!n.read_at, created_at: n.created_at,
      event_title: detail.event_title, amount: detail.remaining || detail.amount, due: detail.start_date, business_unit: detail.business_unit_name, category: detail.category, status: detail.status });
  }
  return { unread: out.filter(n => !n.read).length, items: out.slice(0, 30) };
}
export function markNotificationsRead(db: Database.Database, c: Caps, ids: number[] | 'all') {
  if (ids === 'all') db.prepare("UPDATE calendar_notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL").run(c.userId);
  else for (const id of ids) db.prepare("UPDATE calendar_notifications SET read_at = datetime('now') WHERE id = ? AND user_id = ? AND read_at IS NULL").run(id, c.userId);
}

// Called by every read route: overdue automation + due reminders.
export function runMaintenance(db: Database.Database, today: string) {
  sweepCalendar(db, today);
  generateNotifications(db, today);
}
