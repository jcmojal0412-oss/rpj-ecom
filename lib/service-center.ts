// Pure logic for the Service Center rework — status derivation, revenue
// split, and date-range resolution. No DB access here, so this stays
// independently testable and shared identically by API routes and the
// client (for optimistic/preview computations).

export const REPAIR_STATUSES = [
  'Received', 'Diagnosing', 'Waiting for Parts', 'Repairing',
  'Ready for Pickup', 'Completed', 'Cancelled',
] as const;
export type RepairStatus = typeof REPAIR_STATUSES[number];

export type CustomerPaymentStatus = 'Unpaid' | 'Partial' | 'Paid';
export type TechPayoutStatus = 'Not Due' | 'Due' | 'Paid';

const SPLIT_BNS = 0.6;
const SPLIT_TECH = 0.4;

export interface RevenueSplit { labor: number; bns: number; tech: number; }

// Repair Amount (formerly "CS Payment") minus parts cost, split 60/40
// BNS/Technician — unchanged from the original computation.
export function computeSplit(repairAmount: number, cogs: number): RevenueSplit {
  const labor = repairAmount - cogs;
  return { labor, bns: labor * SPLIT_BNS, tech: labor * SPLIT_TECH };
}

// Collected is the sum of the customer-payments ledger for this repair.
// Paid once collected reaches (or exceeds, e.g. rounding) the repair amount.
export function deriveCustomerPaymentStatus(collected: number, repairAmount: number): CustomerPaymentStatus {
  if (repairAmount <= 0) return collected > 0 ? 'Paid' : 'Unpaid';
  if (collected >= repairAmount - 0.005) return 'Paid';
  if (collected > 0) return 'Partial';
  return 'Unpaid';
}

// Independent from customer payment status by design — gated only by
// whether the repair work itself is finished (Ready for Pickup / Completed)
// and whether there's anything to pay out at all.
export function deriveTechPayoutStatus(
  paidOut: number, techEarnings: number, repairStatus: RepairStatus | null
): TechPayoutStatus {
  if (techEarnings <= 0) return 'Not Due';
  if (paidOut >= techEarnings - 0.005) return 'Paid';
  if (repairStatus === 'Ready for Pickup' || repairStatus === 'Completed') return 'Due';
  return 'Not Due';
}

export type ServicePeriodKey = 'today' | 'week' | 'month' | 'custom';

export interface ServicePeriodRange { from: string; to: string; label: string; }

function toLocalISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function weekStart(dateStr: string): Date {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}
function shortDate(d: Date): string {
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

// `anchor` is a plain YYYY-MM-DD the caller steps forward/backward via
// shiftServiceAnchor — resolveServicePeriod turns it into a concrete range.
export function resolveServicePeriod(
  key: ServicePeriodKey, anchor: string, customFrom?: string, customTo?: string
): ServicePeriodRange {
  if (key === 'today') {
    const d = new Date(anchor + 'T00:00:00');
    return { from: anchor, to: anchor, label: d.toLocaleDateString('en-PH', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' }) };
  }
  if (key === 'week') {
    const monday = weekStart(anchor);
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
    return { from: toLocalISO(monday), to: toLocalISO(sunday), label: `${shortDate(monday)} – ${shortDate(sunday)}, ${sunday.getFullYear()}` };
  }
  if (key === 'month') {
    const d = new Date(anchor + 'T00:00:00');
    const from = new Date(d.getFullYear(), d.getMonth(), 1);
    const to = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return { from: toLocalISO(from), to: toLocalISO(to), label: d.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' }) };
  }
  // custom
  const from = customFrom || anchor;
  const to = customTo || anchor;
  const df = new Date(from + 'T00:00:00'), dt = new Date(to + 'T00:00:00');
  return { from, to, label: `${shortDate(df)} – ${shortDate(dt)}, ${dt.getFullYear()}` };
}

// Moves the anchor by one natural unit of the given period key (a day, a
// week, a month) — 'custom' has no natural step and is a no-op.
export function shiftServiceAnchor(key: ServicePeriodKey, anchor: string, dir: 1 | -1): string {
  const d = new Date(anchor + 'T00:00:00');
  if (key === 'today') d.setDate(d.getDate() + dir);
  else if (key === 'week') d.setDate(d.getDate() + dir * 7);
  else if (key === 'month') d.setMonth(d.getMonth() + dir);
  else return anchor;
  return toLocalISO(d);
}
