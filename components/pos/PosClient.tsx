'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import {
  Search, Plus, Minus, Trash2, ArrowLeft, History, Printer, ScanBarcode, RotateCw, X,
  Banknote, Smartphone, Landmark, CreditCard, Wallet, Layers, Ticket, Zap, CalendarClock, Gift,
  ChevronDown, ChevronUp,
} from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Toast, useToast } from '@/components/ui/Toast';
import Spinner from '@/components/ui/Spinner';
import Modal from '@/components/ui/Modal';
import ReceiptView from './ReceiptView';
import ReturnExchangeClient from './ReturnExchangeClient';
import { SERVICE_FEE_ITEMS, FINANCING_PROVIDERS, type Business, type Product, type CartLine, type Sale, type SaleItem, type Shift, type ServiceFeeItem, type FinancingByProvider } from './constants';
import { EXPENSE_CATEGORIES } from '@/components/expenses/constants';

interface SessionUser { id: number; name: string; role?: string; }

// Sentinel category value selecting the Services and fees tab — not a real
// product category, so it can never collide with one loaded from the DB.
const SERVICES_TAB = '__services__';
// Sentinel category value selecting the "In Stock" quick filter — same
// no-collision trick as SERVICES_TAB.
const IN_STOCK_TAB = '__in_stock__';

type PaymentMode = 'Cash' | 'Online' | 'Card' | 'Split' | 'Financing';

// Tender options for a Split payment row or a Financing downpayment row —
// unlike the single Cash/Online/Card mode buttons, these two both collect
// across an unlimited number of rows, each independently tagged with one
// of these methods.
const SPLIT_METHODS = ['Cash', 'GCash', 'Maya', 'Sodexo', 'Bank Transfer', 'Credit Card'];

interface PaymentLegRow { key: string; method: string; amount: string; referenceNo: string; }
let legRowSeq = 0;
const newLegRow = (method: string = 'Cash'): PaymentLegRow => ({ key: `leg${++legRowSeq}`, method, amount: '', referenceNo: '' });

// Non-cash payment labels the system already recognizes (kept identical to
// the strings used before this redesign so historical sales/reports that
// group by payment_method text stay meaningful going forward). Financing
// providers (Salmon/Skyro/Billease) are intentionally NOT here — they cover
// a financed balance, not an ordinary payment, so they live only under the
// dedicated Financing tab (see FINANCING_PROVIDERS).
const ONLINE_PROVIDERS = ['GCash', 'Maya', 'Sodexo', 'Bank Transfer'];

const PAYMENT_METHOD_ICONS: Record<string, React.ElementType> = {
  Cash: Banknote, GCash: Smartphone, Salmon: Wallet, 'Cash + GCash': Layers,
  'Credit Card': CreditCard, Maya: Smartphone, Sodexo: Ticket,
  'Bank Transfer': Landmark, Skyro: Zap, Billease: CalendarClock,
};

// Suggests a few "nice" round cash amounts at or above the total due, so the
// cashier can tap a realistic bill combination instead of stacking small
// denominations one at a time. Pure function of the total — no state.
function suggestCashOptions(total: number): number[] {
  if (!(total > 0)) return [100, 500, 1000];
  const roundUpTo = (n: number, mult: number) => Math.ceil(n / mult) * mult;
  const opts = [roundUpTo(total, 500), roundUpTo(total, 1000)];
  const bigStep = total < 1000 ? 500 : total < 5000 ? 1000 : total < 20000 ? 5000 : 10000;
  const bigRound = roundUpTo(total, bigStep);
  opts.push(bigRound <= Math.max(...opts) ? bigRound + bigStep : bigRound);
  return Array.from(new Set(opts.filter(o => o > total))).sort((a, b) => a - b).slice(0, 3);
}

// Compact clear-then-edit money/percent field for the dark totals/payment
// boxes — module scope so it isn't re-created (and re-mounted, losing focus)
// on every PosClient render.
function InlineField({ value, onChange, suffix }: { value: string; onChange: (v: string) => void; suffix?: string }) {
  return (
    <div className="flex items-center shrink-0">
      <button type="button" onClick={() => onChange('')} title="Clear"
        className="w-6 h-6 flex items-center justify-center rounded-l-md border border-r-0 border-white/40 bg-white/90 text-gray-500 hover:bg-white shrink-0">
        <X size={11} />
      </button>
      <input type="number" min="0" step="0.01" value={value} onChange={e => onChange(e.target.value)} placeholder="0.00"
        className="w-20 rounded-r-md border border-white/40 bg-white text-gray-800 text-xs text-right px-2 py-1 focus:outline-none focus:ring-1 focus:ring-white placeholder-gray-400" />
      {suffix && <span className="ml-1 text-xs text-white/70">{suffix}</span>}
    </div>
  );
}

interface ReadingTotals {
  transaction_count: number; cash_sales: number; online_sales: number; total_sales: number;
  total_discount: number; void_count: number; void_amount: number; refund_amount: number;
  cash_in: number; cash_out: number;
  starting_cash: number; expected_cash: number; actual_cash?: number; discrepancy?: number;
  financing_receivable?: number; financing_by_provider?: FinancingByProvider[];
}
interface XReading extends ReadingTotals { shift: Shift; generated_at: string; }
interface ZReading extends ReadingTotals {
  business_name: string | null; cashier_name: string | null; time_in: string; time_out: string;
  actual_cash: number; discrepancy: number;
}

// Peso denominations for the physical cash count at End Shift — internal
// cash-accountability tool only, not a BIR-accredited reading.
const DENOMINATIONS = [1000, 500, 200, 100, 50, 20, 10, 5, 1, 0.25];

// Printable X/Z Reading layout — X is a non-destructive mid-shift snapshot
// (can be pulled repeatedly), Z is the final closing summary. Both reuse the
// same visual shape, just fed different data and a different title. This is
// an internal cash-accountability report, not a BIR-accredited CRM/POS
// X-Reading/Z-Reading — it is explicitly labeled as such below.
function ReadingSlip({ title, businessName, cashierName, timeIn, timeOut, data, denominationCounts }: {
  title: string; businessName: string | null; cashierName: string | null; timeIn: string; timeOut: string | null;
  data: ReadingTotals; denominationCounts?: Record<number, number>;
}) {
  return (
    <div className="max-w-xs mx-auto">
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <div className="text-center">
          <p className="font-bold text-gray-900">{businessName || 'RPJ ECOM'}</p>
          <p className="text-sm font-semibold text-orange-600 mt-1">{title}</p>
          <p className="text-xs text-gray-400 mt-1">Cashier: {cashierName || '—'}</p>
          <p className="text-xs text-gray-400">{formatDate(timeIn)} — {timeOut ? formatDate(timeOut) : 'Ongoing'}</p>
        </div>

        <div className="border-t border-dashed border-gray-200 pt-3 space-y-1 text-sm">
          <div className="flex justify-between text-gray-500"><span>Transactions</span><span className="tabular-nums">{data.transaction_count}</span></div>
          <div className="flex justify-between text-gray-500"><span>Cash Sales</span><span className="tabular-nums">{formatCurrency(data.cash_sales)}</span></div>
          <div className="flex justify-between text-gray-500"><span>Online Sales</span><span className="tabular-nums">{formatCurrency(data.online_sales)}</span></div>
          {data.total_discount > 0 && <div className="flex justify-between text-gray-500"><span>Total Discount</span><span className="tabular-nums">-{formatCurrency(data.total_discount)}</span></div>}
          {data.void_count > 0 && <div className="flex justify-between text-gray-500"><span>Voided ({data.void_count})</span><span className="tabular-nums">{formatCurrency(data.void_amount)}</span></div>}
          {data.refund_amount > 0 && <div className="flex justify-between text-gray-500"><span>Refunded</span><span className="tabular-nums">-{formatCurrency(data.refund_amount)}</span></div>}
          <div className="flex justify-between font-bold text-gray-900 pt-1"><span>Net Sales</span><span className="tabular-nums">{formatCurrency(data.total_sales)}</span></div>
        </div>

        {!!data.financing_receivable && data.financing_receivable > 0 && (
          <div className="border-t border-dashed border-gray-200 pt-3 space-y-1 text-sm">
            <p className="text-xs font-semibold text-gray-500 mb-1">Financing Receivable</p>
            {(data.financing_by_provider ?? []).map(f => (
              <div key={f.provider} className="flex justify-between text-gray-500 text-xs">
                <span>{f.provider}</span><span className="tabular-nums">{formatCurrency(f.amount)}</span>
              </div>
            ))}
            <div className="flex justify-between font-semibold text-gray-700 pt-0.5">
              <span>Total Receivable</span><span className="tabular-nums">{formatCurrency(data.financing_receivable)}</span>
            </div>
          </div>
        )}

        {denominationCounts && (
          <div className="border-t border-dashed border-gray-200 pt-3 space-y-1 text-sm">
            <p className="text-xs font-semibold text-gray-500 mb-1">Cash Count</p>
            {DENOMINATIONS.filter(d => (denominationCounts[d] ?? 0) > 0).map(d => (
              <div key={d} className="flex justify-between text-gray-500 text-xs">
                <span>₱{d} × {denominationCounts[d]}</span><span className="tabular-nums">{formatCurrency(d * denominationCounts[d])}</span>
              </div>
            ))}
          </div>
        )}

        <div className="border-t border-dashed border-gray-200 pt-3 space-y-1 text-sm">
          <div className="flex justify-between text-gray-500"><span>Starting Cash</span><span className="tabular-nums">{formatCurrency(data.starting_cash)}</span></div>
          {data.cash_in > 0 && <div className="flex justify-between text-gray-500"><span>Cash Added</span><span className="tabular-nums">{formatCurrency(data.cash_in)}</span></div>}
          {data.cash_out > 0 && <div className="flex justify-between text-gray-500"><span>Cash Drop</span><span className="tabular-nums">-{formatCurrency(data.cash_out)}</span></div>}
          <div className="flex justify-between text-gray-500"><span>Expected Cash</span><span className="tabular-nums">{formatCurrency(data.expected_cash)}</span></div>
          {data.actual_cash != null && (
            <div className="flex justify-between text-gray-500"><span>Actual Cash</span><span className="tabular-nums">{formatCurrency(data.actual_cash)}</span></div>
          )}
          {data.discrepancy != null && (
            <div className="flex justify-between font-bold pt-1">
              <span className="text-gray-700">Discrepancy</span>
              <span className={`tabular-nums ${data.discrepancy === 0 ? 'text-gray-900' : data.discrepancy > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                {data.discrepancy > 0 ? '+' : ''}{formatCurrency(data.discrepancy)}
              </span>
            </div>
          )}
        </div>

        <p className="text-center text-[10px] text-gray-400 pt-2 border-t border-dashed border-gray-200">FOR INTERNAL USE ONLY — Not a BIR-accredited document</p>
      </div>
    </div>
  );
}

// Optional clock-in/out with cash-drawer reconciliation. Starting a shift is
// never required to check out a sale — it's purely additive accountability
// for cashiers who want it.
function ShiftControl({ businessId, showToast }: { businessId: string; showToast: (msg: string, type?: 'success' | 'error') => void }) {
  const [shift, setShift] = useState<Shift | null>(null);
  const [loading, setLoading] = useState(true);
  const [showStart, setShowStart] = useState(false);
  const [confirmEndShift, setConfirmEndShift] = useState(false);
  const [showEnd, setShowEnd] = useState(false);
  const [startingCash, setStartingCash] = useState('');
  const [startNote, setStartNote] = useState('');
  const [denomCounts, setDenomCounts] = useState<Record<number, string>>({});
  const [endNote, setEndNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [xReading, setXReading] = useState<XReading | null>(null);
  const [zReading, setZReading] = useState<ZReading | null>(null);
  const [zDenomCounts, setZDenomCounts] = useState<Record<number, number>>({});
  const [showCashMove, setShowCashMove] = useState(false);
  const [moveType, setMoveType] = useState<'IN' | 'OUT'>('IN');
  const [moveAmount, setMoveAmount] = useState('');
  const [moveNote, setMoveNote] = useState('');
  const [showExpense, setShowExpense] = useState(false);
  const [expCategory, setExpCategory] = useState('');
  const [expPaidTo, setExpPaidTo] = useState('');
  const [expAmount, setExpAmount] = useState('');
  const [expNote, setExpNote] = useState('');

  const declaredCash = DENOMINATIONS.reduce((sum, d) => sum + d * (parseInt(denomCounts[d]) || 0), 0);

  const loadShift = () => {
    if (!businessId) return;
    setLoading(true);
    fetch(`/api/pos/shifts/current?business_id=${businessId}`).then(r => r.json()).then(d => setShift(d.shift)).finally(() => setLoading(false));
  };

  useEffect(() => { loadShift(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [businessId]);

  const startShift = async () => {
    setSubmitting(true);
    try {
      const res = await fetch('/api/pos/shifts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: Number(businessId), starting_cash: parseFloat(startingCash) || 0, notes: startNote }),
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.error || 'Failed to start shift', 'error'); return; }
      showToast('Shift started');
      setShowStart(false); setStartingCash(''); setStartNote(''); loadShift();
    } finally { setSubmitting(false); }
  };

  const runXReading = async () => {
    if (!shift) return;
    const data = await fetch(`/api/pos/shifts/${shift.id}/xreading`).then(r => r.json());
    setXReading(data);
  };

  const submitCashMove = async () => {
    if (!shift) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/pos/shifts/${shift.id}/cash-movements`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: moveType, amount: parseFloat(moveAmount) || 0, note: moveNote }),
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.error || 'Failed to record cash movement', 'error'); return; }
      showToast(moveType === 'IN' ? 'Cash added to drawer' : 'Cash removed from drawer');
      setShowCashMove(false); setMoveAmount(''); setMoveNote(''); setMoveType('IN');
    } finally { setSubmitting(false); }
  };

  const submitExpense = async () => {
    if (!shift) return;
    if (!expCategory || !expPaidTo.trim() || !expAmount) { showToast('Category, Paid To, and Amount are required', 'error'); return; }
    setSubmitting(true);
    try {
      const res = await fetch('/api/expenses', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: Number(businessId), category: expCategory, date: new Date().toISOString().slice(0, 10),
          amount: expAmount, paid_to: expPaidTo, payment_method: 'Cash', notes: expNote, shift_id: shift.id,
        }),
      });
      const data = await res.json();
      if (res.status === 409) { showToast('Possible duplicate expense — check the Expenses page', 'error'); return; }
      if (!res.ok) { showToast(data.error || 'Failed to record expense', 'error'); return; }
      showToast('Expense recorded against this shift');
      setShowExpense(false); setExpCategory(''); setExpPaidTo(''); setExpAmount(''); setExpNote('');
    } finally { setSubmitting(false); }
  };

  const endShift = async () => {
    if (!shift) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/pos/shifts/${shift.id}/close`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actual_cash: declaredCash, notes: endNote }),
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.error || 'Failed to end shift', 'error'); return; }
      const countsSnapshot: Record<number, number> = {};
      DENOMINATIONS.forEach(d => { countsSnapshot[d] = parseInt(denomCounts[d]) || 0; });
      setZDenomCounts(countsSnapshot);
      setZReading(data);
      setShowEnd(false); setDenomCounts({}); setEndNote(''); loadShift();
    } finally { setSubmitting(false); }
  };

  if (loading) return null;

  return (
    <>
      {shift ? (
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Status only — not an action, so it's not a button. */}
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
            ON SHIFT <span className="font-normal text-emerald-600">· {formatDate(shift.time_in)}</span>
          </div>
          <button onClick={runXReading} className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 text-gray-600 hover:bg-gray-200">
            X Reading
          </button>
          <button onClick={() => setShowCashMove(true)} className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 text-gray-600 hover:bg-gray-200">
            Cash In/Out
          </button>
          <button onClick={() => setShowExpense(true)} className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 text-gray-600 hover:bg-gray-200">
            Record Expense
          </button>
          <button onClick={() => setConfirmEndShift(true)} className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-white text-amber-700 border border-amber-300 hover:bg-amber-50">
            End Shift
          </button>
        </div>
      ) : (
        <button onClick={() => setShowStart(true)} className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 text-gray-600 hover:bg-gray-200">
          Start Shift
        </button>
      )}

      {showStart && (
        <Modal open onClose={() => setShowStart(false)} title="Start Shift" size="sm">
          <div className="space-y-4">
            <div>
              <label className="form-label">Starting Cash (₱)</label>
              <input type="number" min="0" step="0.01" className="form-input" placeholder="0.00" value={startingCash} onChange={e => setStartingCash(e.target.value)} autoFocus />
              <p className="text-xs text-gray-400 mt-1">Cash you're placing in the drawer at the start of this shift.</p>
            </div>
            <div>
              <label className="form-label">Notes (Optional)</label>
              <input className="form-input" placeholder="e.g. May sirang bill counter" value={startNote} onChange={e => setStartNote(e.target.value)} />
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowStart(false)} disabled={submitting} className="btn-secondary">Cancel</button>
              <button onClick={startShift} disabled={submitting} className="btn-primary">{submitting ? 'Starting...' : 'Start Shift'}</button>
            </div>
          </div>
        </Modal>
      )}

      {confirmEndShift && (
        <Modal open onClose={() => setConfirmEndShift(false)} title="End current shift?" size="sm">
          <div className="space-y-4">
            <p className="text-sm text-gray-600">You will proceed to shift closing / actual cash count.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirmEndShift(false)} className="btn-secondary">Cancel</button>
              <button onClick={() => { setConfirmEndShift(false); setShowEnd(true); }} className="btn-primary !bg-amber-600 hover:!bg-amber-700">End Shift</button>
            </div>
          </div>
        </Modal>
      )}

      {showEnd && shift && (
        <Modal open onClose={() => setShowEnd(false)} title="End Shift" size="sm">
          <div className="space-y-4">
            <div>
              <p className="form-label mb-2">Cash Count</p>
              <div className="space-y-1.5">
                {DENOMINATIONS.map(d => (
                  <div key={d} className="grid grid-cols-3 gap-2 items-center">
                    <span className="text-sm text-gray-600">₱{d}</span>
                    <input type="number" min="0" step="1" className="form-input py-1 text-sm" placeholder="0"
                      value={denomCounts[d] ?? ''} onChange={e => setDenomCounts(prev => ({ ...prev, [d]: e.target.value }))} />
                    <span className="text-sm text-gray-500 text-right tabular-nums">{formatCurrency(d * (parseInt(denomCounts[d]) || 0))}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between items-center mt-3 pt-3 border-t border-gray-100">
                <span className="text-sm font-semibold text-gray-700">Total Declared Cash</span>
                <span className="text-lg font-bold text-gray-900 tabular-nums">{formatCurrency(declaredCash)}</span>
              </div>
              <p className="text-xs text-gray-400 mt-1">Physically count the cash in the drawer by denomination.</p>
            </div>
            <div>
              <label className="form-label">Notes (Optional)</label>
              <input className="form-input" placeholder="e.g. Kulang ng change fund" value={endNote} onChange={e => setEndNote(e.target.value)} />
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowEnd(false)} disabled={submitting} className="btn-secondary">Cancel</button>
              <button onClick={endShift} disabled={submitting} className="btn-danger">{submitting ? 'Ending...' : 'End Shift'}</button>
            </div>
          </div>
        </Modal>
      )}

      {showCashMove && (
        <Modal open onClose={() => setShowCashMove(false)} title="Cash In/Out" size="sm">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setMoveType('IN')} className={`py-2 rounded-lg text-sm font-semibold border ${moveType === 'IN' ? 'bg-emerald-50 border-emerald-400 text-emerald-700' : 'bg-white border-gray-200 text-gray-500'}`}>Cash In</button>
              <button onClick={() => setMoveType('OUT')} className={`py-2 rounded-lg text-sm font-semibold border ${moveType === 'OUT' ? 'bg-red-50 border-red-400 text-red-600' : 'bg-white border-gray-200 text-gray-500'}`}>Cash Out</button>
            </div>
            <div>
              <label className="form-label">Amount (₱)</label>
              <input type="number" min="0" step="0.01" className="form-input" placeholder="0.00" value={moveAmount} onChange={e => setMoveAmount(e.target.value)} autoFocus />
            </div>
            <div>
              <label className="form-label">Note (Optional)</label>
              <input className="form-input" placeholder="e.g. Petty cash top-up, bank deposit" value={moveNote} onChange={e => setMoveNote(e.target.value)} />
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowCashMove(false)} disabled={submitting} className="btn-secondary">Cancel</button>
              <button onClick={submitCashMove} disabled={submitting} className="btn-primary">{submitting ? 'Saving...' : `Record Cash ${moveType === 'IN' ? 'In' : 'Out'}`}</button>
            </div>
          </div>
        </Modal>
      )}

      {showExpense && (
        <Modal open onClose={() => setShowExpense(false)} title="Record Expense" size="sm">
          <div className="space-y-4">
            <p className="text-xs text-gray-500">Paid out of this shift's cash drawer — recorded in Expenses and linked to this shift.</p>
            <div>
              <label className="form-label">Category</label>
              <select className="form-input" value={expCategory} onChange={e => setExpCategory(e.target.value)} autoFocus>
                <option value="">— Select category —</option>
                {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Paid To</label>
              <input className="form-input" placeholder="e.g. Sari-sari store" value={expPaidTo} onChange={e => setExpPaidTo(e.target.value)} />
            </div>
            <div>
              <label className="form-label">Amount (₱)</label>
              <input type="number" min="0" step="0.01" className="form-input" placeholder="0.00" value={expAmount} onChange={e => setExpAmount(e.target.value)} />
            </div>
            <div>
              <label className="form-label">Notes (Optional)</label>
              <input className="form-input" placeholder="What was this for?" value={expNote} onChange={e => setExpNote(e.target.value)} />
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowExpense(false)} disabled={submitting} className="btn-secondary">Cancel</button>
              <button onClick={submitExpense} disabled={submitting} className="btn-primary">{submitting ? 'Saving...' : 'Record Expense'}</button>
            </div>
          </div>
        </Modal>
      )}

      {xReading && (
        <Modal open onClose={() => setXReading(null)} title="X Reading" size="sm">
          <ReadingSlip title="X READING (Interim — Shift Still Open)" businessName={xReading.shift.business_name} cashierName={xReading.shift.cashier_name}
            timeIn={xReading.shift.time_in} timeOut={null}
            data={{ ...xReading, starting_cash: xReading.shift.starting_cash }} />
          <div className="flex justify-center gap-3 mt-4 print:hidden">
            <button onClick={() => setXReading(null)} className="btn-secondary">Close</button>
            <button onClick={() => window.print()} className="btn-primary"><Printer size={15} /> Print</button>
          </div>
        </Modal>
      )}

      {zReading && (
        <Modal open onClose={() => setZReading(null)} title="Z Reading" size="sm">
          <ReadingSlip title="Z READING (Shift Closed)" businessName={zReading.business_name} cashierName={zReading.cashier_name}
            timeIn={zReading.time_in} timeOut={zReading.time_out}
            data={zReading} denominationCounts={zDenomCounts} />
          <div className="flex justify-center gap-3 mt-4 print:hidden">
            <button onClick={() => setZReading(null)} className="btn-secondary">Done</button>
            <button onClick={() => window.print()} className="btn-primary"><Printer size={15} /> Print</button>
          </div>
        </Modal>
      )}
    </>
  );
}

export default function PosClient() {
  const [products, setProducts] = useState<Product[]>([]);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [cashier, setCashier] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const [businessId, setBusinessId] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [showOutOfStock, setShowOutOfStock] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discount, setDiscount] = useState('');
  const [additionalFee, setAdditionalFee] = useState('');
  const [taxPercent, setTaxPercent] = useState('');
  const [serviceCharge, setServiceCharge] = useState('');
  const [deliveryFee, setDeliveryFee] = useState('');
  const [cashAmount, setCashAmount] = useState('');
  const [onlineAmount, setOnlineAmount] = useState('');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('Cash');
  const [onlineProvider, setOnlineProvider] = useState(ONLINE_PROVIDERS[0]);
  const [referenceNo, setReferenceNo] = useState('');
  const [financingProvider, setFinancingProvider] = useState<string | null>(null);
  // Split payment and a Financing downpayment both collect across an
  // unlimited number of {method, amount, reference} rows rather than a
  // fixed Cash+Online pair — same row-list pattern used elsewhere in this
  // session (Bulk Stock Entry, the manual sale backfill form).
  const [splitRows, setSplitRows] = useState<PaymentLegRow[]>(() => [newLegRow('Cash'), newLegRow('GCash')]);
  const [dpRows, setDpRows] = useState<PaymentLegRow[]>(() => [newLegRow('Cash')]);
  // Cashback Redeemed and Downpayment/Reservation Applied are checkout-level
  // deductions against Amount Due — not payment methods, not discounts, and
  // not the same as Financing's own internal downpayment (see amountDue calc
  // below). They apply no matter which payment mode is ultimately used.
  const [cashbackAmount, setCashbackAmount] = useState('');
  const [downpaymentApplied, setDownpaymentApplied] = useState('');
  // Collapsed by default — most sales don't need these, and showing all 5
  // fields up front was crowding the cart list down to 2-3 visible rows.
  const [showAdjustments, setShowAdjustments] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<{ sale: Sale; items: SaleItem[]; payments?: { method: string; amount: number; reference_no: string | null }[] } | null>(null);
  const [pickingService, setPickingService] = useState<ServiceFeeItem | null>(null);
  const [serviceAmountInput, setServiceAmountInput] = useState('');
  const [freebieTarget, setFreebieTarget] = useState<CartLine | null>(null);
  const [freebieReasonInput, setFreebieReasonInput] = useState('');
  const [posMode, setPosMode] = useState<'sale' | 'return'>('sale');
  // Owner-controlled escape hatch for a store that hasn't finished its
  // general inventory count yet (most products sitting at 0) — while on,
  // the POS lets a sale go through regardless of recorded stock instead of
  // blocking checkout on numbers that aren't trustworthy yet.
  const [allowZeroStock, setAllowZeroStock] = useState(false);
  const { toast, showToast, clearToast } = useToast();
  const searchRef = useRef<HTMLInputElement>(null);
  const isOwner = cashier?.role === 'owner';

  const loadProducts = () => fetch('/api/pos/products').then(r => r.json()).then(d => setProducts(d.rows ?? []));

  useEffect(() => {
    Promise.all([
      loadProducts(),
      fetch('/api/businesses').then(r => r.json()).then(d => {
        // The POS is only actually operated for Bodega ni Suki — showing
        // every business here (e.g. RPJ ECOM) just risks a cashier picking
        // the wrong one and attributing a whole shift to it. Reports/
        // Purchase Orders/Expenses elsewhere in the app still see every
        // business normally; this filter is scoped to the POS's own
        // selector only.
        const allRows: Business[] = d.rows ?? [];
        const rows = allRows.filter(b => b.name === 'Bodega ni Suki');
        setBusinesses(rows.length ? rows : allRows);
        setBusinessId(String((rows[0] ?? allRows[0])?.id ?? ''));
      }).catch(() => {
        // businessId staying empty silently stalls the shift-controls area
        // forever (it can't look up a shift without a business) — surface
        // it instead of leaving the cashier looking at a POS with no Start
        // Shift button and no clue why.
        showToast('Could not load business info — try refreshing the page', 'error');
      }),
      fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(u => { if (u) setCashier(u); }),
      fetch('/api/pos/config').then(r => r.json()).then(d => setAllowZeroStock(!!d.allow_zero_stock)),
    ]).finally(() => setLoading(false));
  }, []);

  const toggleAllowZeroStock = async () => {
    const next = !allowZeroStock;
    setAllowZeroStock(next); // optimistic — this is a low-stakes toggle
    const res = await fetch('/api/pos/config', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allow_zero_stock: next }),
    });
    if (!res.ok) { setAllowZeroStock(!next); showToast('Failed to update setting', 'error'); }
  };

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    products.forEach(p => { if (p.category) counts.set(p.category, (counts.get(p.category) ?? 0) + 1); });
    const inStockCount = products.filter(p => p.quantity > 0).length;
    return [
      { name: 'All', count: products.length },
      { name: IN_STOCK_TAB, count: inStockCount },
      ...[...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count })),
    ];
  }, [products]);

  const outOfStockCount = useMemo(() => products.filter(p => p.quantity <= 0).length, [products]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter(p => {
      if (category === IN_STOCK_TAB) {
        if (p.quantity <= 0) return false;
      } else {
        if (category !== 'All' && p.category !== category) return false;
        // Zero-stock items are always visible while the bypass is on — the
        // whole point is that these numbers aren't trustworthy right now,
        // so hiding them behind a separate checkbox would defeat it.
        if (p.quantity <= 0 && !showOutOfStock && !allowZeroStock) return false;
      }
      if (q && !p.name.toLowerCase().includes(q) && !p.sku.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [products, search, category, showOutOfStock, allowZeroStock]);

  const addToCart = (p: Product) => {
    if (p.quantity <= 0 && !allowZeroStock) { showToast(`${p.name} is out of stock`, 'error'); return; }
    setCart(prev => {
      // A freebie line never absorbs a later "Add to Cart" click for the
      // same product — e.g. customer gets 1 free unit via a promo, then
      // decides to buy a 2nd at full price; that needs its own paid line
      // rather than silently doubling the freebie. Stock is still checked
      // against the combined quantity across every line of this product,
      // unless the zero-stock bypass is on.
      const totalInCart = prev.filter(l => l.kind === 'product' && l.product_id === p.id).reduce((s, l) => s + l.quantity, 0);
      if (!allowZeroStock && totalInCart >= p.quantity) { showToast(`Only ${p.quantity} in stock`, 'error'); return prev; }
      const existing = prev.find(l => l.kind === 'product' && l.product_id === p.id && !l.is_freebie);
      if (existing) {
        return prev.map(l => l === existing ? { ...l, quantity: l.quantity + 1 } : l);
      }
      return [...prev, { kind: 'product', key: `p-${p.id}-${Date.now()}`, product_id: p.id, name: p.name, sku: p.sku, unit_price: p.srp ?? 0, quantity: 1, stock: p.quantity }];
    });
  };

  const addServiceToCart = (item: ServiceFeeItem, amount: number) => {
    setCart(prev => [...prev, {
      kind: 'service', key: `s-${item.sku}-${Date.now()}`, name: item.name, sku: item.sku,
      unit_price: amount, quantity: 1,
    }]);
  };

  const changeQty = (key: string, delta: number) => {
    setCart(prev => {
      const target = prev.find(l => l.key === key);
      if (!target) return prev;
      const next = target.quantity + delta;
      // When a product has more than one line (e.g. one freebie + one paid),
      // the stock cap has to account for every line sharing that product,
      // not just this one — otherwise two lines could each independently
      // "fit" under the total stock while together overselling it.
      if (!allowZeroStock && delta > 0 && target.kind === 'product' && target.stock != null) {
        const others = prev.filter(l => l.kind === 'product' && l.product_id === target.product_id && l.key !== key)
          .reduce((s, l) => s + l.quantity, 0);
        if (next + others > target.stock) { showToast(`Only ${target.stock} in stock`, 'error'); return prev; }
      }
      return prev.map(l => l.key === key ? { ...l, quantity: next } : l).filter(l => l.quantity > 0);
    });
  };

  const removeLine = (key: string) => setCart(prev => prev.filter(l => l.key !== key));

  // Freebie/promo: forces selling price to 0 while preserving the original
  // price so it can be restored on unmark — inventory/COGS are untouched by
  // this (still keyed off the same product_id/quantity), only unit_price
  // changes, so subtotal/total/Gross Sales naturally exclude it with no
  // other calculation needing to change.
  const confirmFreebie = () => {
    if (!freebieTarget) return;
    setCart(prev => prev.map(l => l.key === freebieTarget.key
      ? { ...l, is_freebie: true, original_price: l.unit_price, unit_price: 0, freebie_reason: freebieReasonInput.trim() || undefined }
      : l));
    setFreebieTarget(null); setFreebieReasonInput('');
  };
  const unmarkFreebie = (key: string) => {
    setCart(prev => prev.map(l => (l.key === key && l.is_freebie)
      ? { ...l, is_freebie: false, unit_price: l.original_price ?? l.unit_price, original_price: undefined, freebie_reason: undefined }
      : l));
  };
  const clearCart = () => {
    setCart([]); setDiscount(''); setAdditionalFee(''); setTaxPercent(''); setServiceCharge(''); setDeliveryFee('');
    setCashAmount(''); setOnlineAmount(''); setPaymentMode('Cash'); setOnlineProvider(ONLINE_PROVIDERS[0]); setReferenceNo('');
    setFinancingProvider(null); setDpRows([newLegRow('Cash')]); setSplitRows([newLegRow('Cash'), newLegRow('GCash')]);
    setCashbackAmount(''); setDownpaymentApplied('');
    setFreebieTarget(null); setFreebieReasonInput('');
  };

  const updateSplitRow = (key: string, patch: Partial<PaymentLegRow>) => setSplitRows(rows => rows.map(r => r.key === key ? { ...r, ...patch } : r));
  const addSplitRow = () => setSplitRows(rows => [...rows, newLegRow()]);
  const removeSplitRow = (key: string) => setSplitRows(rows => rows.length > 1 ? rows.filter(r => r.key !== key) : rows);

  const updateDpRow = (key: string, patch: Partial<PaymentLegRow>) => setDpRows(rows => rows.map(r => r.key === key ? { ...r, ...patch } : r));
  const addDpRow = () => setDpRows(rows => [...rows, newLegRow()]);
  const removeDpRow = (key: string) => setDpRows(rows => rows.length > 1 ? rows.filter(r => r.key !== key) : rows);

  const subtotal = cart.reduce((s, l) => s + l.unit_price * l.quantity, 0);
  const freebieCount = cart.filter(l => l.is_freebie).length;
  const discountNum = parseFloat(discount) || 0;
  const feeNum = parseFloat(additionalFee) || 0;
  const taxPercentNum = parseFloat(taxPercent) || 0;
  const serviceChargeNum = parseFloat(serviceCharge) || 0;
  const deliveryFeeNum = parseFloat(deliveryFee) || 0;
  const preTax = Math.max(0, subtotal - discountNum + feeNum);
  const taxAmount = preTax * (taxPercentNum / 100);
  // `total` is the Net Sale value (unchanged) — the true value of the
  // transaction, kept separate from how much the customer still owes today.
  const total = Math.max(0, preTax + taxAmount + serviceChargeNum + deliveryFeeNum);

  // Cashback Redeemed (loyalty value used) and Downpayment/Reservation
  // Applied (money the store already collected in an earlier, separate
  // transaction) are NOT discounts and NOT payment legs — they're
  // deductions against what's owed today. Amount Due, not the raw total, is
  // what every payment mode below (Cash/Online/Card/Split/Financing) is
  // actually validated and paid against.
  const cashbackNum = parseFloat(cashbackAmount) || 0;
  const downpaymentAppliedNum = parseFloat(downpaymentApplied) || 0;
  const adjustmentsExceedTotal = cashbackNum + downpaymentAppliedNum > total + 0.005;
  const amountDue = Math.max(0, total - cashbackNum - downpaymentAppliedNum);
  const hasActiveAdjustments = feeNum > 0 || discountNum > 0 || taxPercentNum > 0 || cashbackNum > 0 || downpaymentAppliedNum > 0;
  const adjustmentsVisible = showAdjustments || hasActiveAdjustments;

  const cashNum = parseFloat(cashAmount) || 0;
  const onlineNum = parseFloat(onlineAmount) || 0;
  const splitTotal = splitRows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
  const totalPayment = paymentMode === 'Split' ? splitTotal : cashNum + onlineNum;
  const changeDue = totalPayment - amountDue;

  // Financing: the store only ever collects its own downpayment (dpTotal,
  // summed across dpRows) toward Amount Due — Remaining Financing is always
  // derived, never hand-entered, so it can't drift out of sync with
  // Amount Due - DP the way a manually-typed number could. Zero DP is a
  // valid, common case (fully financed) — dpRows simply has no rows with an
  // amount in that case. This is separate from Downpayment/Reservation
  // Applied above, which is money already collected before this sale, not
  // today.
  const dpDeclared = dpRows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
  const financedAmount = Math.max(0, amountDue - dpDeclared);
  const financingValid = !!financingProvider && dpDeclared >= 0 && dpDeclared <= amountDue + 0.005 && referenceNo.trim().length > 0;

  const canCheckout = cart.length > 0 && !!businessId && !submitting && !adjustmentsExceedTotal &&
    (paymentMode === 'Financing' ? financingValid : totalPayment + 0.005 >= amountDue);

  const applyExactCash = () => setCashAmount(Math.max(0, amountDue - onlineNum).toFixed(2));
  const cashQuickOptions = useMemo(() => suggestCashOptions(amountDue), [amountDue]);

  // Switching modes never leaves a stale amount in the box that's no longer
  // shown — Cash clears Online, Online/Card clear Cash and default the
  // amount to what's due, Split resets to a fresh two-row default so the
  // cashier can allocate the split themselves. Leaving Financing clears its
  // temporary values so they can't leak into a later non-financing checkout.
  const selectPaymentMode = (mode: PaymentMode) => {
    setPaymentMode(mode);
    if (mode === 'Cash') {
      setOnlineAmount('');
    } else if (mode === 'Online' || mode === 'Card') {
      setCashAmount('');
      setOnlineAmount(amountDue > 0 ? amountDue.toFixed(2) : '');
    } else if (mode === 'Split') {
      setSplitRows([newLegRow('Cash'), newLegRow('GCash')]);
    } else if (mode === 'Financing') {
      setFinancingProvider(null); setDpRows([newLegRow('Cash')]);
    }
    if (mode !== 'Financing') {
      setFinancingProvider(null); setDpRows([newLegRow('Cash')]);
    }
  };

  // Keep the Online/Card "Amount Paid" default in sync if the cart or the
  // Cashback/Downpayment adjustments change while one of those modes is active.
  useEffect(() => {
    if (paymentMode === 'Online' || paymentMode === 'Card') {
      setOnlineAmount(amountDue > 0 ? amountDue.toFixed(2) : '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amountDue]);

  const selectFinancingProvider = (p: string) => {
    setFinancingProvider(p);
    setDpRows([newLegRow('Cash')]);
  };

  const financingDpLabel = dpDeclared <= 0
    ? `${financingProvider ?? ''} Financing`.trim()
    : [...new Set(dpRows.filter(r => (parseFloat(r.amount) || 0) > 0).map(r => r.method))].join(' + ') || 'Cash';

  const effectivePaymentMethod =
    paymentMode === 'Financing' ? financingDpLabel :
    paymentMode === 'Cash' ? 'Cash' :
    paymentMode === 'Card' ? 'Credit Card' :
    paymentMode === 'Online' ? onlineProvider :
    paymentMode === 'Split' ? ([...new Set(splitRows.filter(r => (parseFloat(r.amount) || 0) > 0).map(r => r.method))].join(' + ') || 'Cash') :
    'Cash';

  const completeSale = async () => {
    if (!canCheckout) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/pos/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: Number(businessId),
          items: cart.map(l => l.kind === 'product'
            ? { product_id: l.product_id, quantity: l.quantity, is_freebie: !!l.is_freebie, freebie_reason: l.freebie_reason }
            : { service_name: l.name, sku: l.sku, amount: l.unit_price }),
          discount: discountNum, additional_fee: feeNum,
          tax_percent: taxPercentNum, service_charge: serviceChargeNum, delivery_fee: deliveryFeeNum,
          cash_amount: cashNum, online_amount: onlineNum,
          payment_method: effectivePaymentMethod, reference_no: referenceNo,
          // Unlimited-leg breakdown — Split sends the whole payment as rows;
          // Financing sends just its downpayment rows. Only one is ever
          // populated per submission (both undefined outside those modes),
          // and the server derives cash_amount/online_amount from whichever
          // is present rather than trusting the fields above in that case.
          payments:
            paymentMode === 'Split' ? splitRows.filter(r => (parseFloat(r.amount) || 0) > 0).map(r => ({ method: r.method, amount: parseFloat(r.amount) || 0, reference_no: r.referenceNo || null })) :
            paymentMode === 'Financing' && dpDeclared > 0 ? dpRows.filter(r => (parseFloat(r.amount) || 0) > 0).map(r => ({ method: r.method, amount: parseFloat(r.amount) || 0, reference_no: r.referenceNo || null })) :
            undefined,
          financing_provider: paymentMode === 'Financing' ? financingProvider : null,
          cashback_amount: cashbackNum, downpayment_applied: downpaymentAppliedNum,
        }),
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.error || 'Failed to complete sale', 'error'); return; }

      const detail = await fetch(`/api/pos/sales/${data.id}`).then(r => r.json());
      setReceipt(detail);
      clearCart();
      loadProducts();
    } finally {
      setSubmitting(false);
    }
  };

  const newSale = () => setReceipt(null);

  if (loading) {
    return <div className="h-screen flex items-center justify-center bg-gray-50"><Spinner /></div>;
  }

  if (receipt) {
    return (
      <div className="h-screen overflow-auto bg-gray-50 py-10 px-4">
        {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}
        <ReceiptView sale={receipt.sale} items={receipt.items} payments={receipt.payments}>
          <button onClick={() => window.print()} className="btn-secondary"><Printer size={15} /> Print</button>
          <button onClick={newSale} className="btn-primary">New Sale</button>
        </ReceiptView>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}

      {/* Top bar */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-white border-b border-gray-200 shrink-0 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/" className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 shrink-0" title="Back to Dashboard"><ArrowLeft size={18} /></Link>
          <select className="form-input py-1.5 text-sm w-auto" value={businessId} onChange={e => setBusinessId(e.target.value)}>
            {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          {businessId && <ShiftControl businessId={businessId} showToast={showToast} />}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Transaction mode — a state selector, not a utility action, so it
              gets segmented-tab treatment and a clear divider away from the
              shift tools rather than sitting inline with them. */}
          <div className="flex items-center gap-2 pl-3 border-l border-gray-200">
            <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
              <button onClick={() => setPosMode('sale')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${posMode === 'sale' ? 'bg-orange-500 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                Sale
              </button>
              <button onClick={() => setPosMode('return')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${posMode === 'return' ? 'bg-red-500 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                Return / Exchange
              </button>
            </div>
          </div>
          {cashier && <span className="text-xs text-gray-500 shrink-0">Cashier: <span className="font-semibold text-gray-800">{cashier.name}</span></span>}
          <Link href="/pos/sales" className="btn-secondary text-xs py-1.5 shrink-0"><History size={13} /> Sales History</Link>
        </div>
      </div>

      {posMode === 'return' ? (
        <div className="flex-1 overflow-auto bg-red-50/40">
          <ReturnExchangeClient
            businessId={businessId}
            cashierName={cashier?.name || '—'}
            isOwner={isOwner}
            showToast={showToast}
            onDone={() => setPosMode('sale')}
          />
        </div>
      ) : (
      <div className="flex-1 flex overflow-hidden">
        {/* Product grid */}
        <div className="w-[60%] flex flex-col overflow-hidden p-4">
          <div className="relative mb-3 shrink-0">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
            <input ref={searchRef} className="form-input pl-9" placeholder="Search product or scan barcode..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="flex items-center gap-2 mb-2 flex-wrap shrink-0">
            {categoryCounts.map(c => (
              <button key={c.name} onClick={() => setCategory(c.name)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${category === c.name ? 'bg-orange-500 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-100'}`}>
                {c.name === IN_STOCK_TAB ? 'In Stock' : c.name} <span className="opacity-70">({c.count})</span>
              </button>
            ))}
            <button onClick={() => setCategory(SERVICES_TAB)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${category === SERVICES_TAB ? 'bg-orange-500 text-white' : 'bg-white border border-orange-200 text-orange-600 hover:bg-orange-50'}`}>
              Services
            </button>
          </div>
          <div className="flex items-center gap-4 mb-3 shrink-0 flex-wrap">
            <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
              <input type="checkbox" className="rounded border-gray-300 text-orange-500 focus:ring-orange-400"
                checked={showOutOfStock} onChange={e => setShowOutOfStock(e.target.checked)} />
              Show Out of Stock
              {outOfStockCount > 0 && !showOutOfStock && <span className="text-gray-400">({outOfStockCount} hidden)</span>}
            </label>
            {/* Owner-only escape hatch for a store mid-migration into this
                POS (inventory not yet counted, so most products sit at 0) —
                lets a sale go through regardless of recorded stock. Any
                cashier can see the current state (it explains why "Out"
                items are sellable), but only the owner can flip it. */}
            {isOwner ? (
              <label className={`flex items-center gap-1.5 text-xs cursor-pointer select-none ${allowZeroStock ? 'text-amber-700 font-semibold' : 'text-gray-500'}`}>
                <input type="checkbox" className="rounded border-gray-300 text-amber-500 focus:ring-amber-400"
                  checked={allowZeroStock} onChange={toggleAllowZeroStock} />
                Allow selling at 0 stock (inventory not yet counted)
              </label>
            ) : allowZeroStock && (
              <span className="text-xs text-amber-700 font-semibold">Zero-stock sales allowed (owner setting)</span>
            )}
          </div>
          <div className="flex-1 overflow-auto">
            {category === SERVICES_TAB ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5">
                {SERVICE_FEE_ITEMS.map(item => (
                  <button key={item.sku} onClick={() => setPickingService(item)}
                    className="bg-white border border-orange-200 rounded-lg p-2.5 text-left hover:border-orange-400 hover:shadow-sm transition-all">
                    <p className="text-xs font-semibold text-gray-800 leading-snug line-clamp-2 min-h-[2rem]">{item.name}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{item.sku}</p>
                    <span className="inline-block mt-1.5 text-[9px] font-semibold bg-orange-50 text-orange-700 px-1.5 py-0.5 rounded">Custom amount</span>
                  </button>
                ))}
              </div>
            ) : filteredProducts.length === 0 ? (
              <p className="text-center text-gray-400 text-sm py-12">No products found.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5">
                {filteredProducts.map(p => (
                  <button key={p.id} onClick={() => addToCart(p)} disabled={p.quantity <= 0 && !allowZeroStock}
                    className="bg-white border border-gray-200 rounded-lg p-2.5 text-left hover:border-orange-300 hover:shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                    <p className="text-xs font-semibold text-gray-800 leading-snug line-clamp-2 min-h-[2rem]">{p.name}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{p.sku}</p>
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-xs font-bold text-orange-600 tabular-nums">{formatCurrency(p.srp ?? 0)}</span>
                      <span className={`text-[9px] font-semibold ${p.quantity <= 0 ? 'text-red-500' : p.quantity <= 5 ? 'text-amber-600' : 'text-gray-400'}`}>
                        {p.quantity <= 0 ? (allowZeroStock ? 'Not counted' : 'Out') : `${p.quantity} left`}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Cart / payment */}
        <div className="w-[40%] bg-white border-l border-gray-200 flex flex-col overflow-hidden shrink-0">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0 flex-wrap gap-2">
            <p className="text-sm font-semibold text-gray-800">Current Order</p>
            <div className="flex items-center gap-1.5">
              <button onClick={() => searchRef.current?.focus()}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors">
                <ScanBarcode size={13} /> Barcode
              </button>
              <button onClick={loadProducts}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border border-green-300 text-green-700 hover:bg-green-50 transition-colors">
                <RotateCw size={13} /> Refresh
              </button>
              {cart.length > 0 && (
                <button onClick={clearCart}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border border-red-300 text-red-600 hover:bg-red-50 transition-colors">
                  Clear All
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-auto px-4 py-2">
            {cart.length === 0 ? (
              <p className="text-center text-gray-400 text-sm py-10 italic">Empty cart</p>
            ) : (
              <div className="space-y-2">
                {cart.map(l => (
                  <div key={l.key} className="flex items-center gap-2 py-2 border-b border-gray-50">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="text-xs font-medium text-gray-800 truncate">{l.name}</p>
                        {l.is_freebie && <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">Freebie</span>}
                      </div>
                      <p className="text-[11px] text-gray-400 tabular-nums">
                        {l.kind === 'service' ? 'Service / fee'
                          : l.is_freebie ? `Original ${formatCurrency(l.original_price ?? 0)} each`
                          : `${formatCurrency(l.unit_price)} each`}
                      </p>
                    </div>
                    {l.kind === 'product' && (
                      <>
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => changeQty(l.key, -1)} className="p-1 rounded hover:bg-gray-100 text-gray-500"><Minus size={12} /></button>
                          <span className="text-xs font-semibold w-5 text-center tabular-nums">{l.quantity}</span>
                          <button onClick={() => changeQty(l.key, 1)} className="p-1 rounded hover:bg-gray-100 text-gray-500"><Plus size={12} /></button>
                        </div>
                        <button
                          onClick={() => l.is_freebie ? unmarkFreebie(l.key) : setFreebieTarget(l)}
                          title={l.is_freebie ? 'Remove Freebie status' : 'Mark as Freebie'}
                          className={`p-1 rounded shrink-0 ${l.is_freebie ? 'text-orange-600 hover:bg-orange-50' : 'text-gray-300 hover:bg-gray-100 hover:text-gray-500'}`}>
                          <Gift size={13} />
                        </button>
                      </>
                    )}
                    <span className={`text-xs font-bold w-16 text-right tabular-nums shrink-0 ${l.is_freebie ? 'text-orange-600' : 'text-gray-900'}`}>
                      {l.is_freebie ? 'FREE' : formatCurrency(l.unit_price * l.quantity)}
                    </span>
                    <button onClick={() => removeLine(l.key)} className="p-1 rounded hover:bg-red-50 text-gray-300 hover:text-red-500 shrink-0"><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-gray-100 px-4 py-3 space-y-3 shrink-0 overflow-y-auto max-h-[68vh]">
            {/* Additional Fee / Discounts / Tax / Cashback / Downpayment are
                collapsed by default — most sales use none of them, and
                showing all 5 fields up front was crowding the cart list
                down to just 2-3 visible rows. Forced open (and the toggle
                effectively disabled) while any of them has a value, so an
                active discount/fee can never end up hidden. */}
            <button type="button" onClick={() => setShowAdjustments(v => !v)}
              className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700">
              {adjustmentsVisible ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              Discount, Fee, Tax, Cashback, Downpayment
            </button>
            {adjustmentsVisible && (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-[11px] text-gray-500 font-medium">Additional Fee</label>
                    <input type="number" min="0" step="0.01" className="form-input py-1.5 text-xs" placeholder="0.00" value={additionalFee} onChange={e => setAdditionalFee(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-[11px] text-gray-500 font-medium">Discount</label>
                    <input type="number" min="0" step="0.01" className="form-input py-1.5 text-xs" placeholder="0.00" value={discount} onChange={e => setDiscount(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-[11px] text-gray-500 font-medium">Tax (%)</label>
                    <input type="number" min="0" step="0.01" className="form-input py-1.5 text-xs" placeholder="0" value={taxPercent} onChange={e => setTaxPercent(e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] text-gray-500 font-medium">Cashback Redeemed</label>
                    <input type="number" min="0" step="0.01" className="form-input py-1.5 text-xs" placeholder="0.00" value={cashbackAmount} onChange={e => setCashbackAmount(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-[11px] text-gray-500 font-medium">Downpayment / Reservation Applied</label>
                    <input type="number" min="0" step="0.01" className="form-input py-1.5 text-xs" placeholder="0.00" value={downpaymentApplied} onChange={e => setDownpaymentApplied(e.target.value)} />
                  </div>
                </div>
              </>
            )}
            {adjustmentsExceedTotal && (
              <p className="text-[11px] text-red-500 font-medium -mt-1">Cashback Redeemed + Downpayment Applied cannot exceed the Total.</p>
            )}

            {/* Totals — Service Charge/Delivery Fee are edited inline, matching the reference layout.
                Cashback Redeemed and Downpayment Applied are deductions against what's owed today,
                not discounts (which change the selling price) and not payment legs — Total (Net
                Sale) stays untouched above them, and AMOUNT DUE is the true bottom line. */}
            <div className="bg-emerald-500 text-white rounded-xl p-3 space-y-1.5">
              <div className="flex justify-between items-center text-xs"><span className="text-white/90">Subtotal</span><span className="tabular-nums font-semibold">{formatCurrency(subtotal)}</span></div>
              {freebieCount > 0 && <div className="flex justify-between items-center text-xs"><span className="text-white/90">Freebies</span><span className="tabular-nums font-semibold">{freebieCount} item{freebieCount === 1 ? '' : 's'}</span></div>}
              <div className="flex justify-between items-center text-xs"><span className="text-white/90">Additional Fee</span><span className="tabular-nums font-semibold">{formatCurrency(feeNum)}</span></div>
              <div className="flex justify-between items-center text-xs"><span className="text-white/90">Discount</span><span className="tabular-nums font-semibold">-{formatCurrency(discountNum)}</span></div>
              {cashbackNum > 0 && <div className="flex justify-between items-center text-xs"><span className="text-white/90">Cashback Redeemed</span><span className="tabular-nums font-semibold">-{formatCurrency(cashbackNum)}</span></div>}
              {downpaymentAppliedNum > 0 && <div className="flex justify-between items-center text-xs"><span className="text-white/90">Downpayment Applied</span><span className="tabular-nums font-semibold">-{formatCurrency(downpaymentAppliedNum)}</span></div>}
              <div className="flex justify-between items-center text-xs"><span className="text-white/90">Tax ({taxPercentNum}%)</span><span className="tabular-nums font-semibold">{formatCurrency(taxAmount)}</span></div>
              <div className="flex justify-between items-center text-xs"><span className="text-white/90">Service Charge</span><InlineField value={serviceCharge} onChange={setServiceCharge} /></div>
              <div className="flex justify-between items-center text-xs"><span className="text-white/90">Delivery Fee</span><InlineField value={deliveryFee} onChange={setDeliveryFee} /></div>
              <div className="flex justify-between items-center text-lg font-bold pt-1.5 border-t border-white/25"><span>AMOUNT DUE</span><span className="tabular-nums">{formatCurrency(amountDue)}</span></div>
            </div>

            {/* Customer Payment — redesigned for a single at-a-glance flow:
                pick a mode, fill only the fields that mode needs, see the
                total/payment/change summary right below. */}
            <div className="border-t border-gray-100 pt-3">
              <div className="flex items-baseline justify-between mb-2">
                <p className="text-xs font-semibold text-gray-700">Customer Payment</p>
                <span className="text-sm font-bold text-gray-900 tabular-nums">Amount Due: {formatCurrency(amountDue)}</span>
              </div>

              <div className="grid grid-cols-5 gap-1.5 mb-3">
                {(['Cash', 'Online', 'Card', 'Split', 'Financing'] as PaymentMode[]).map(m => (
                  <button key={m} onClick={() => selectPaymentMode(m)}
                    className={`py-2 rounded-lg text-[11px] font-bold tracking-wide transition-all ${paymentMode === m ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                    {m === 'Online' ? 'ONLINE / QR' : m.toUpperCase()}
                  </button>
                ))}
              </div>

              {paymentMode === 'Cash' && (
                <div className="space-y-2">
                  <div>
                    <label className="text-[11px] text-gray-500 font-medium">Amount Received</label>
                    <input type="number" min="0" step="0.01" className="form-input text-sm" placeholder="0.00" value={cashAmount} onChange={e => setCashAmount(e.target.value)} />
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    <button onClick={applyExactCash} className="px-2 py-1.5 rounded-md text-xs font-semibold border border-orange-300 text-orange-700 hover:bg-orange-50">Exact</button>
                    {cashQuickOptions.map(amt => (
                      <button key={amt} onClick={() => setCashAmount(String(amt))}
                        className="px-2 py-1.5 rounded-md text-xs font-semibold border border-blue-200 text-blue-700 hover:bg-blue-50 tabular-nums">
                        {formatCurrency(amt)}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {paymentMode === 'Online' && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {ONLINE_PROVIDERS.map(p => {
                    const Icon = PAYMENT_METHOD_ICONS[p];
                    return (
                      <button key={p} onClick={() => setOnlineProvider(p)}
                        className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold border transition-all ${onlineProvider === p ? 'bg-blue-50 border-blue-400 text-blue-700' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                        {Icon && <Icon size={12} />} {p}
                      </button>
                    );
                  })}
                </div>
              )}

              {paymentMode === 'Online' && (
                <div className="space-y-2">
                  <div>
                    <label className="text-[11px] text-gray-500 font-medium">Amount Paid</label>
                    <input type="number" min="0" step="0.01" className="form-input text-sm" placeholder="0.00" value={onlineAmount} onChange={e => setOnlineAmount(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-[11px] text-gray-500 font-medium">Reference No.</label>
                    <input className="form-input text-sm" placeholder="Input reference number" value={referenceNo} onChange={e => setReferenceNo(e.target.value)} />
                  </div>
                </div>
              )}

              {paymentMode === 'Card' && (
                <div className="space-y-2">
                  <div>
                    <label className="text-[11px] text-gray-500 font-medium">Amount Paid</label>
                    <input type="number" min="0" step="0.01" className="form-input text-sm" placeholder="0.00" value={onlineAmount} onChange={e => setOnlineAmount(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-[11px] text-gray-500 font-medium">Reference / Approval No. (Optional)</label>
                    <input className="form-input text-sm" placeholder="Approval code" value={referenceNo} onChange={e => setReferenceNo(e.target.value)} />
                  </div>
                </div>
              )}

              {paymentMode === 'Split' && (
                <div className="space-y-2">
                  {splitRows.map(row => (
                    <div key={row.key} className="grid grid-cols-12 gap-1.5 items-center">
                      <select className="form-input text-xs col-span-4 py-1.5" value={row.method} onChange={e => updateSplitRow(row.key, { method: e.target.value })}>
                        {SPLIT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                      <input type="number" min="0" step="0.01" className="form-input text-xs col-span-3 py-1.5" placeholder="0.00"
                        value={row.amount} onChange={e => updateSplitRow(row.key, { amount: e.target.value })} />
                      <input className="form-input text-xs col-span-4 py-1.5" placeholder="Ref # (optional)"
                        value={row.referenceNo} onChange={e => updateSplitRow(row.key, { referenceNo: e.target.value })} />
                      <button type="button" onClick={() => removeSplitRow(row.key)} disabled={splitRows.length === 1}
                        className="col-span-1 text-gray-400 hover:text-red-600 disabled:opacity-30 flex justify-center">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  <button type="button" onClick={addSplitRow} className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium">
                    <Plus size={13} /> Add Payment
                  </button>
                  <div className="flex justify-between items-center text-xs pt-1">
                    <span className="text-gray-500">Split Total</span>
                    <span className={`font-semibold tabular-nums ${splitTotal + 0.005 >= amountDue ? 'text-emerald-600' : 'text-gray-700'}`}>{formatCurrency(splitTotal)}</span>
                  </div>
                </div>
              )}

              {paymentMode === 'Financing' && (
                <div className="space-y-2">
                  <div className="grid grid-cols-3 gap-1.5">
                    {FINANCING_PROVIDERS.map(p => {
                      const Icon = PAYMENT_METHOD_ICONS[p];
                      return (
                        <button key={p} onClick={() => selectFinancingProvider(p)}
                          className={`flex flex-col items-center gap-1 py-2 rounded-lg border transition-all ${financingProvider === p ? 'bg-blue-50 border-blue-500' : 'bg-gray-50 border-gray-200 hover:bg-gray-100'}`}>
                          {Icon && <Icon size={16} className={financingProvider === p ? 'text-blue-600' : 'text-gray-500'} />}
                          <span className={`text-[11px] font-bold ${financingProvider === p ? 'text-blue-700' : 'text-gray-600'}`}>{p.toUpperCase()}</span>
                        </button>
                      );
                    })}
                  </div>

                  {financingProvider && (
                    <div className="space-y-2">
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-gray-500">Amount Due</span>
                        <span className="font-semibold text-gray-900 tabular-nums">{formatCurrency(amountDue)}</span>
                      </div>
                      <div>
                        <label className="text-[11px] text-gray-500 font-medium">Downpayment to Bodega ni Suki</label>
                        <div className="space-y-1.5 mt-1">
                          {dpRows.map(row => (
                            <div key={row.key} className="grid grid-cols-12 gap-1.5 items-center">
                              <select className="form-input text-xs col-span-4 py-1.5" value={row.method} onChange={e => updateDpRow(row.key, { method: e.target.value })}>
                                {SPLIT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                              </select>
                              <input type="number" min="0" step="0.01" className="form-input text-xs col-span-3 py-1.5" placeholder="0.00"
                                value={row.amount} onChange={e => updateDpRow(row.key, { amount: e.target.value })} />
                              <input className="form-input text-xs col-span-4 py-1.5" placeholder="Ref # (optional)"
                                value={row.referenceNo} onChange={e => updateDpRow(row.key, { referenceNo: e.target.value })} />
                              <button type="button" onClick={() => removeDpRow(row.key)} disabled={dpRows.length === 1}
                                className="col-span-1 text-gray-400 hover:text-red-600 disabled:opacity-30 flex justify-center">
                                <Trash2 size={14} />
                              </button>
                            </div>
                          ))}
                          <button type="button" onClick={addDpRow} className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium">
                            <Plus size={13} /> Add Payment
                          </button>
                        </div>
                        {dpDeclared > amountDue + 0.005 && (
                          <p className="text-[11px] text-red-500 font-medium mt-1">Downpayment cannot exceed the Amount Due.</p>
                        )}
                      </div>

                      <div className="flex justify-between items-center text-sm pt-1 border-t border-gray-100">
                        <span className="text-gray-600 font-medium">Remaining - {financingProvider} Financing</span>
                        <span className="font-bold text-gray-900 tabular-nums">{formatCurrency(financedAmount)}</span>
                      </div>

                      <div>
                        <label className="text-[11px] text-gray-500 font-medium">Financing Reference / Application No.</label>
                        <input className="form-input text-sm" placeholder="Required" value={referenceNo} onChange={e => setReferenceNo(e.target.value)} />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Payment summary — Financing gets a compact 3-line recap
                  instead of the generic Change box, since "change" doesn't
                  apply here and Remaining Financing is already shown above. */}
              {paymentMode === 'Financing' ? (
                financingProvider && (
                  <div className="bg-blue-500 text-white rounded-xl p-3 space-y-1 mt-3">
                    <p className="text-[11px] font-bold text-white/70 tracking-wide">FINANCING SUMMARY</p>
                    <div className="flex justify-between items-center text-xs"><span className="text-white/80">Amount Due</span><span className="font-semibold tabular-nums">{formatCurrency(amountDue)}</span></div>
                    <div className="flex justify-between items-center text-xs"><span className="text-white/80">Downpayment</span><span className="font-semibold tabular-nums">{formatCurrency(dpDeclared)}</span></div>
                    <div className="flex justify-between items-center text-sm font-bold pt-1 border-t border-white/25"><span>{financingProvider} Financing</span><span className="tabular-nums">{formatCurrency(financedAmount)}</span></div>
                  </div>
                )
              ) : (
                <div className="bg-blue-500 text-white rounded-xl p-3 space-y-1.5 mt-3">
                  <div className="flex justify-between items-center text-xs"><span className="text-white/80">Amount Due</span><span className="font-semibold tabular-nums">{formatCurrency(amountDue)}</span></div>
                  <div className="flex justify-between items-center text-xs"><span className="text-white/80">Total Payment</span><span className="font-semibold tabular-nums">{formatCurrency(totalPayment)}</span></div>
                  {changeDue >= 0 ? (
                    <div className="flex justify-between items-center text-lg font-bold pt-1.5 border-t border-white/25"><span>Change</span><span className="tabular-nums">{formatCurrency(changeDue)}</span></div>
                  ) : (
                    <div className="flex justify-between items-center text-lg font-bold pt-1.5 border-t border-white/25"><span>Remaining</span><span className="tabular-nums text-red-200">{formatCurrency(Math.abs(changeDue))}</span></div>
                  )}
                </div>
              )}
            </div>

            <button onClick={completeSale} disabled={!canCheckout} className="btn-primary w-full justify-center py-3 text-sm disabled:opacity-40">
              {submitting ? 'Processing...' : 'Complete Sale'}
            </button>
          </div>
        </div>
      </div>
      )}

      {pickingService && (
        <Modal open onClose={() => { setPickingService(null); setServiceAmountInput(''); }} title={pickingService.name} size="sm">
          <div className="space-y-4">
            <div>
              <label className="form-label">Amount (₱)</label>
              <input type="number" min="0" step="0.01" className="form-input" placeholder="0.00" autoFocus
                value={serviceAmountInput} onChange={e => setServiceAmountInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && parseFloat(serviceAmountInput) > 0) {
                    addServiceToCart(pickingService, parseFloat(serviceAmountInput));
                    setPickingService(null); setServiceAmountInput('');
                  }
                }} />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => { setPickingService(null); setServiceAmountInput(''); }} className="btn-secondary">Cancel</button>
              <button
                onClick={() => { addServiceToCart(pickingService, parseFloat(serviceAmountInput)); setPickingService(null); setServiceAmountInput(''); }}
                disabled={!(parseFloat(serviceAmountInput) > 0)}
                className="btn-primary disabled:opacity-40">
                Add to Order
              </button>
            </div>
          </div>
        </Modal>
      )}

      {freebieTarget && (
        <Modal open onClose={() => { setFreebieTarget(null); setFreebieReasonInput(''); }} title="Mark this item as FREEBIE?" size="sm">
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-lg p-3 space-y-1.5">
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-500">Original SRP</span>
                <span className="font-semibold text-gray-900 tabular-nums">{formatCurrency(freebieTarget.unit_price)}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-500">Selling Price</span>
                <span className="font-bold text-orange-600 tabular-nums">₱0.00</span>
              </div>
            </div>
            <p className="text-xs text-gray-500">Inventory will still be deducted normally.</p>
            <div>
              <label className="text-[11px] text-gray-500 font-medium">Freebie Reason / Promo (Optional)</label>
              <input className="form-input text-sm" placeholder="e.g. Buy 1 Take 1, Bundle Promo, Manager Approved"
                value={freebieReasonInput} onChange={e => setFreebieReasonInput(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => { setFreebieTarget(null); setFreebieReasonInput(''); }} className="btn-secondary">Cancel</button>
              <button onClick={confirmFreebie} className="btn-primary">Confirm Freebie</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
