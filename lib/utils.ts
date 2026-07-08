import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(value);
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

// Returns today's date in Philippine time (UTC+8, no DST) as YYYY-MM-DD,
// regardless of the runtime's local timezone. Server containers typically
// run UTC, and .toISOString() alone is 8 hours (and sometimes a calendar
// day) behind PH local time between midnight and 8am — this shift avoids
// that by reading the UTC calendar date of the PH-shifted instant.
export function todayISO(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function generatePONumber(): string {
  // BNS series starting from BNS10001340
  const base = 10001340;
  const now   = Date.now();
  const seq   = (now % 100000);
  return `BNS${base + seq}`;
}
