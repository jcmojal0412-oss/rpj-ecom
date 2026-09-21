'use client';

import { CATEGORY_BY_KEY, STATUS_LABEL, STATUS_STYLE } from '@/lib/calendar';

export interface CalEvent {
  id: number; event_title: string; event_type: string; category: string; financial_type: 'PAYMENT' | 'COLLECTION' | 'NONE';
  business_unit_id: number | null; business_unit_name: string | null; assigned_user_id: number | null; assigned_name: string | null;
  start_date: string; end_date: string; start_time: string | null; end_time: string | null; all_day: number;
  description: string | null; amount: number | null; paid: number; remaining: number; status: string; overdue: boolean; stored_status: string;
  privacy: string; meeting_location: string | null; meeting_link: string | null; recurrence_id: number | null; recurrence_text: string | null;
  original_due_date: string | null; payee: string | null; payment_method: string | null; reference_no: string | null; account_bank: string | null;
  created_by: number | null; created_by_name: string | null; created_at: string; updated_at: string; is_demo: number;
  masked?: boolean; can_edit?: boolean; can_pay?: boolean; can_update_status?: boolean;
  attendees?: { user_id: number | null; name: string; email: string | null }[]; reminders?: number[]; attachment_count?: number;
}
export interface Meta {
  today: string; categories: { key: string; label: string; color: string; soft: string; financial: string; kind: string }[];
  business_units: { id: number; name: string }[]; people: { id: number; name: string }[];
  caps: { user_id: number; is_owner: boolean; finance: boolean; payroll: boolean };
}

export const catColor = (key: string) => CATEGORY_BY_KEY[key]?.color ?? '#7B8794';
export const catSoft = (key: string) => CATEGORY_BY_KEY[key]?.soft ?? '#EEF0F3';
export const catLabel = (key: string) => CATEGORY_BY_KEY[key]?.label ?? key;

// Clear, consistent badges: UPCOMING · DUE TODAY · OVERDUE · PARTIALLY PAID · PAID · EXPECTED · RECEIVED · CANCELLED …
export function StatusBadge({ status, overdue, small }: { status: string; overdue?: boolean; small?: boolean }) {
  const st = STATUS_STYLE[status] ?? STATUS_STYLE.scheduled;
  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      <span className={`inline-block rounded-md font-bold tracking-wide ${small ? 'text-[9px] px-1.5 py-0.5' : 'text-[11px] px-2 py-0.5'}`} style={{ color: st.fg, background: st.bg }}>{STATUS_LABEL[status] ?? status.toUpperCase()}</span>
      {overdue && status !== 'overdue' && status !== 'delayed' && <span className={`inline-block rounded-md font-bold tracking-wide ${small ? 'text-[9px] px-1.5 py-0.5' : 'text-[11px] px-2 py-0.5'}`} style={{ color: STATUS_STYLE.overdue.fg, background: STATUS_STYLE.overdue.bg }}>OVERDUE</span>}
    </span>
  );
}

export function CategoryChip({ category }: { category: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md text-[11px] font-semibold px-2 py-0.5" style={{ color: catColor(category), background: catSoft(category) }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: catColor(category) }} />{catLabel(category)}
    </span>
  );
}

export const PAYMENT_METHODS = ['Cash', 'Bank Transfer', 'GCash', 'Maya', 'Check', 'Credit Card', 'Online Banking', 'Other'];

export function niceDate(iso: string, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-PH', { timeZone: 'UTC', ...opts });
}
export const longDate = (iso: string) => niceDate(iso, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
export const whenText = (e: CalEvent, fmt: (t: string) => string) =>
  e.all_day ? 'All day' : `${fmt(e.start_time ?? '')}${e.end_time ? ` – ${fmt(e.end_time)}` : ''}`;
