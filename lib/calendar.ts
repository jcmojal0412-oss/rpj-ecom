// RPJ Operations Calendar — shared constants and pure helpers (no database, safe
// to import from both the server and the browser). Dates are plain
// "YYYY-MM-DD" strings in Philippine time and times are "HH:MM", like the rest
// of the system, so nothing here depends on the viewer's time zone.

export type FinancialType = 'PAYMENT' | 'COLLECTION' | 'NONE';
export type EventKind = 'event' | 'meeting' | 'task';
export type Privacy = 'public' | 'restricted' | 'private';

export interface CategoryDef {
  key: string; label: string; color: string; soft: string;
  financial: FinancialType; kind: EventKind;
}

// Muted enterprise colours: `color` for the event bar / text, `soft` for chips.
export const CATEGORIES: CategoryDef[] = [
  { key: 'payment_due',         label: 'Payment Due',         color: '#B0443A', soft: '#F7E9E7', financial: 'PAYMENT',    kind: 'event' },
  { key: 'meeting',             label: 'Meeting',             color: '#2F5D9E', soft: '#E6EDF7', financial: 'NONE',       kind: 'meeting' },
  { key: 'expected_collection', label: 'Expected Collection', color: '#2E7D5B', soft: '#E4F2EB', financial: 'COLLECTION', kind: 'event' },
  { key: 'payroll',             label: 'Payroll',             color: '#5B4B9A', soft: '#ECE9F6', financial: 'PAYMENT',    kind: 'event' },
  { key: 'supplier_payment',    label: 'Supplier Payment',    color: '#B7702A', soft: '#F8EDDD', financial: 'PAYMENT',    kind: 'event' },
  { key: 'loan_payment',        label: 'Loan Payment',        color: '#8C4A5C', soft: '#F3E7EA', financial: 'PAYMENT',    kind: 'event' },
  { key: 'bills_utilities',     label: 'Bills / Utilities',   color: '#2A7F86', soft: '#E2F1F2', financial: 'PAYMENT',    kind: 'event' },
  { key: 'internal_task',       label: 'Internal Task',       color: '#5F6B7A', soft: '#EBEEF2', financial: 'NONE',       kind: 'task' },
  { key: 'marketing',           label: 'Marketing',           color: '#8E4B87', soft: '#F2E8F1', financial: 'NONE',       kind: 'event' },
  { key: 'operations',          label: 'Operations',          color: '#8A7A2E', soft: '#F3F0DF', financial: 'NONE',       kind: 'event' },
  { key: 'deadline',            label: 'Deadline',            color: '#C28A1B', soft: '#FAF1DC', financial: 'NONE',       kind: 'task' },
  { key: 'other',               label: 'Other',               color: '#7B8794', soft: '#EEF0F3', financial: 'NONE',       kind: 'event' },
];
export const CATEGORY_BY_KEY: Record<string, CategoryDef> = Object.fromEntries(CATEGORIES.map(c => [c.key, c]));

export const DEFAULT_BUSINESS_UNITS = ['RPJ Corporate', 'Bodega ni Suki', 'RPJ ECOM', 'SEDO', 'Tech ni Suki', 'Aircon ni Suki', 'Other'];

// The financial type follows the category, except "Other", which the user picks.
export function financialTypeFor(category: string, requested?: string | null): FinancialType {
  const cat = CATEGORY_BY_KEY[category];
  if (!cat) return 'NONE';
  if (category === 'other' && (requested === 'PAYMENT' || requested === 'COLLECTION' || requested === 'NONE')) return requested;
  return cat.financial;
}
export const kindFor = (category: string): EventKind => CATEGORY_BY_KEY[category]?.kind ?? 'event';

// ---------- statuses ----------
// Stored: payments  upcoming | partially_paid | paid | overdue | cancelled
//         collections expected | partial | received | delayed | cancelled
//         everything else scheduled | completed | cancelled
// "Due Today" is never stored — it is derived from the date (see displayStatus).
export const STATUS_LABEL: Record<string, string> = {
  upcoming: 'UPCOMING', due_today: 'DUE TODAY', paid: 'PAID', partially_paid: 'PARTIALLY PAID', overdue: 'OVERDUE', cancelled: 'CANCELLED',
  expected: 'EXPECTED', received: 'RECEIVED', partial: 'PARTIAL', delayed: 'DELAYED', scheduled: 'SCHEDULED', completed: 'COMPLETED',
};
// Tailwind-free colours so badges look the same everywhere.
export const STATUS_STYLE: Record<string, { fg: string; bg: string }> = {
  upcoming: { fg: '#2F5D9E', bg: '#E6EDF7' }, due_today: { fg: '#9A6A00', bg: '#FBF0D2' }, paid: { fg: '#1F6F4A', bg: '#DFF1E7' },
  partially_paid: { fg: '#8A5A00', bg: '#FBEBCB' }, overdue: { fg: '#A3271F', bg: '#F9E1DE' }, cancelled: { fg: '#6B7280', bg: '#ECEEF1' },
  expected: { fg: '#2F5D9E', bg: '#E6EDF7' }, received: { fg: '#1F6F4A', bg: '#DFF1E7' }, partial: { fg: '#8A5A00', bg: '#FBEBCB' },
  delayed: { fg: '#A3271F', bg: '#F9E1DE' }, scheduled: { fg: '#5F6B7A', bg: '#EBEEF2' }, completed: { fg: '#1F6F4A', bg: '#DFF1E7' },
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export { round2 };

// What the badge should say right now, from the stored status + the money + the date.
// `overdue` is also returned as a flag, so a partly-paid item that is past due can
// show "PARTIALLY PAID" and still be called out as overdue.
export function displayStatus(e: { financial_type: FinancialType; status: string; start_date: string; amount: number | null }, paid: number, today: string): { status: string; overdue: boolean; remaining: number } {
  const amount = e.amount ?? 0;
  const remaining = e.financial_type === 'NONE' ? 0 : Math.max(0, round2(amount - paid));
  if (e.status === 'cancelled') return { status: 'cancelled', overdue: false, remaining };
  if (e.financial_type === 'NONE') return { status: e.status === 'completed' ? 'completed' : 'scheduled', overdue: false, remaining };
  const collection = e.financial_type === 'COLLECTION';
  if (amount > 0 && remaining <= 0.005) return { status: collection ? 'received' : 'paid', overdue: false, remaining: 0 };
  const pastDue = e.start_date < today;
  if (paid > 0.005) return { status: collection ? 'partial' : 'partially_paid', overdue: pastDue, remaining };
  if (pastDue) return { status: collection ? 'delayed' : 'overdue', overdue: true, remaining };
  if (e.start_date === today && !collection) return { status: 'due_today', overdue: false, remaining };
  return { status: collection ? 'expected' : 'upcoming', overdue: false, remaining };
}

// ---------- dates ----------
export const isISODate = (s: unknown): s is string => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};
export const isTime = (s: unknown): s is string => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const toUTC = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const fromUTC = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => fromUTC(toUTC(iso) + n * 86_400_000);
export const daysBetween = (a: string, b: string) => Math.round((toUTC(b) - toUTC(a)) / 86_400_000);
export const weekdayOf = (iso: string) => new Date(toUTC(iso)).getUTCDay(); // 0 = Sunday
export const monthOf = (iso: string) => iso.slice(0, 7);
export const daysInMonth = (year: number, month1: number) => new Date(Date.UTC(year, month1, 0)).getUTCDate();
export const monthBounds = (ym: string) => { const [y, m] = ym.split('-').map(Number); return { from: `${ym}-01`, to: `${ym}-${String(daysInMonth(y, m)).padStart(2, '0')}` }; };
export const addMonthsYM = (ym: string, n: number) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
export const startOfWeek = (iso: string) => addDays(iso, -weekdayOf(iso)); // Sunday-first, like Google Calendar

// "₱105K" / "₱82.5K" / "₱1.2M" for compact calendar chips; full peso elsewhere.
export function compactPeso(n: number): string {
  const v = Math.abs(Number(n) || 0);
  const sign = n < 0 ? '−' : '';
  if (v >= 1_000_000) return `${sign}₱${(v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 2).replace(/\.?0+$/, '')}M`;
  if (v >= 1_000) return `${sign}₱${(v / 1_000).toFixed(v % 1_000 === 0 ? 0 : 1).replace(/\.0$/, '')}K`;
  return `${sign}₱${v.toFixed(v % 1 === 0 ? 0 : 2)}`;
}
export const peso = (n: number) => `${n < 0 ? '−' : ''}₱${Math.abs(Number(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export function fmtTime12(t: string | null | undefined): string {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

// ---------- reminders ----------
export const REMINDER_PRESETS: { days: number; label: string }[] = [
  { days: 0, label: 'Same day' }, { days: 1, label: '1 day before' }, { days: 3, label: '3 days before' }, { days: 7, label: '7 days before' },
];
export const reminderLabel = (d: number) => REMINDER_PRESETS.find(p => p.days === d)?.label ?? `${d} days before`;
// The wording of the in-app alert: "PAYMENT DUE TOMORROW", "SUPPLIER PAYMENT DUE IN 3 DAYS",
// "COLLECTION EXPECTED TODAY", "MEETING TOMORROW", "PAYMENT OVERDUE".
const NOUN: Record<string, string> = {
  payment_due: 'PAYMENT', supplier_payment: 'SUPPLIER PAYMENT', loan_payment: 'LOAN PAYMENT', bills_utilities: 'BILL', payroll: 'PAYROLL',
  expected_collection: 'COLLECTION', meeting: 'MEETING', internal_task: 'TASK', marketing: 'MARKETING SCHEDULE', operations: 'OPERATIONS SCHEDULE', deadline: 'DEADLINE', other: 'SCHEDULE',
};
export function reminderHeadline(e: { category: string; financial_type: FinancialType }, daysLeft: number): string {
  const noun = NOUN[e.category] ?? 'SCHEDULE';
  if (daysLeft < 0) return e.financial_type === 'COLLECTION' ? `${noun} DELAYED` : `${noun} OVERDUE`;
  const when = daysLeft === 0 ? 'TODAY' : daysLeft === 1 ? 'TOMORROW' : `IN ${daysLeft} DAYS`;
  const verb = e.financial_type === 'PAYMENT' ? 'DUE ' : e.financial_type === 'COLLECTION' ? 'EXPECTED ' : '';
  return `${noun} ${verb}${when}`;
}
