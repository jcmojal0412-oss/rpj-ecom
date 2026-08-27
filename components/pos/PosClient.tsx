'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import {
  Search, Plus, Minus, Trash2, ArrowLeft, History, Printer, ScanBarcode, RotateCw, X,
  Banknote, Smartphone, Landmark, CreditCard, Wallet, Layers, Ticket, Zap, CalendarClock,
} from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Toast, useToast } from '@/components/ui/Toast';
import Spinner from '@/components/ui/Spinner';
import Modal from '@/components/ui/Modal';
import ReceiptView from './ReceiptView';
import { CASH_PRESETS, PAYMENT_METHOD_GROUPS, type Business, type Product, type CartLine, type Sale, type SaleItem, type Shift } from './constants';

interface SessionUser { id: number; name: string; }

const PAYMENT_METHOD_ICONS: Record<string, React.ElementType> = {
  Cash: Banknote, GCash: Smartphone, Salmon: Wallet, 'Cash + GCash': Layers,
  'Credit Card': CreditCard, Maya: Smartphone, Sodexo: Ticket,
  'Bank Transfer': Landmark, Skyro: Zap, Billease: CalendarClock,
};

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

// Optional clock-in/out with cash-drawer reconciliation. Starting a shift is
// never required to check out a sale — it's purely additive accountability
// for cashiers who want it.
function ShiftControl({ businessId, showToast }: { businessId: string; showToast: (msg: string, type?: 'success' | 'error') => void }) {
  const [shift, setShift] = useState<Shift | null>(null);
  const [loading, setLoading] = useState(true);
  const [showStart, setShowStart] = useState(false);
  const [showEnd, setShowEnd] = useState(false);
  const [startingCash, setStartingCash] = useState('');
  const [actualCash, setActualCash] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [closeResult, setCloseResult] = useState<{ expected_cash: number; actual_cash: number; discrepancy: number } | null>(null);

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
        body: JSON.stringify({ business_id: Number(businessId), starting_cash: parseFloat(startingCash) || 0 }),
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.error || 'Failed to start shift', 'error'); return; }
      showToast('Shift started');
      setShowStart(false); setStartingCash(''); loadShift();
    } finally { setSubmitting(false); }
  };

  const endShift = async () => {
    if (!shift) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/pos/shifts/${shift.id}/close`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actual_cash: parseFloat(actualCash) || 0 }),
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.error || 'Failed to end shift', 'error'); return; }
      setCloseResult(data);
      setShowEnd(false); setActualCash(''); loadShift();
    } finally { setSubmitting(false); }
  };

  if (loading) return null;

  return (
    <>
      {shift ? (
        <button onClick={() => setShowEnd(true)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> On Shift · {formatDate(shift.time_in)} — End Shift
        </button>
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
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowStart(false)} disabled={submitting} className="btn-secondary">Cancel</button>
              <button onClick={startShift} disabled={submitting} className="btn-primary">{submitting ? 'Starting...' : 'Start Shift'}</button>
            </div>
          </div>
        </Modal>
      )}

      {showEnd && shift && (
        <Modal open onClose={() => setShowEnd(false)} title="End Shift" size="sm">
          <div className="space-y-4">
            <div>
              <label className="form-label">Actual Cash Counted (₱)</label>
              <input type="number" min="0" step="0.01" className="form-input" placeholder="0.00" value={actualCash} onChange={e => setActualCash(e.target.value)} autoFocus />
              <p className="text-xs text-gray-400 mt-1">Physically count the cash in the drawer and enter it here.</p>
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowEnd(false)} disabled={submitting} className="btn-secondary">Cancel</button>
              <button onClick={endShift} disabled={submitting} className="btn-danger">{submitting ? 'Ending...' : 'End Shift'}</button>
            </div>
          </div>
        </Modal>
      )}

      {closeResult && (
        <Modal open onClose={() => setCloseResult(null)} title="Shift Closed" size="sm">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Expected Cash</span><span className="font-semibold tabular-nums">{formatCurrency(closeResult.expected_cash)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Actual Cash</span><span className="font-semibold tabular-nums">{formatCurrency(closeResult.actual_cash)}</span></div>
            <div className="flex justify-between text-base pt-2 border-t border-gray-100">
              <span className="font-semibold text-gray-700">Discrepancy</span>
              <span className={`font-bold tabular-nums ${closeResult.discrepancy === 0 ? 'text-gray-900' : closeResult.discrepancy > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                {closeResult.discrepancy > 0 ? '+' : ''}{formatCurrency(closeResult.discrepancy)}
              </span>
            </div>
          </div>
          <div className="flex justify-end pt-4">
            <button onClick={() => setCloseResult(null)} className="btn-primary">Done</button>
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
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discount, setDiscount] = useState('');
  const [additionalFee, setAdditionalFee] = useState('');
  const [taxPercent, setTaxPercent] = useState('');
  const [serviceCharge, setServiceCharge] = useState('');
  const [deliveryFee, setDeliveryFee] = useState('');
  const [cashAmount, setCashAmount] = useState('');
  const [onlineAmount, setOnlineAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [referenceNo, setReferenceNo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<{ sale: Sale; items: SaleItem[] } | null>(null);
  const { toast, showToast, clearToast } = useToast();
  const searchRef = useRef<HTMLInputElement>(null);

  const loadProducts = () => fetch('/api/pos/products').then(r => r.json()).then(d => setProducts(d.rows ?? []));

  useEffect(() => {
    Promise.all([
      loadProducts(),
      fetch('/api/businesses').then(r => r.json()).then(d => {
        const rows: Business[] = d.rows ?? [];
        setBusinesses(rows);
        const rpjEcom = rows.find(b => b.name === 'RPJ ECOM');
        setBusinessId(String((rpjEcom ?? rows[0])?.id ?? ''));
      }),
      fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(u => { if (u) setCashier(u); }),
    ]).finally(() => setLoading(false));
  }, []);

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    products.forEach(p => { if (p.category) counts.set(p.category, (counts.get(p.category) ?? 0) + 1); });
    return [
      { name: 'All', count: products.length },
      ...[...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count })),
    ];
  }, [products]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter(p => {
      if (category !== 'All' && p.category !== category) return false;
      if (q && !p.name.toLowerCase().includes(q) && !p.sku.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [products, search, category]);

  const addToCart = (p: Product) => {
    if (p.quantity <= 0) { showToast(`${p.name} is out of stock`, 'error'); return; }
    setCart(prev => {
      const existing = prev.find(l => l.product_id === p.id);
      if (existing) {
        if (existing.quantity >= p.quantity) { showToast(`Only ${p.quantity} in stock`, 'error'); return prev; }
        return prev.map(l => l.product_id === p.id ? { ...l, quantity: l.quantity + 1 } : l);
      }
      return [...prev, { product_id: p.id, name: p.name, sku: p.sku, unit_price: p.srp ?? 0, quantity: 1, stock: p.quantity }];
    });
  };

  const changeQty = (productId: number, delta: number) => {
    setCart(prev => prev
      .map(l => {
        if (l.product_id !== productId) return l;
        const next = l.quantity + delta;
        if (next > l.stock) { showToast(`Only ${l.stock} in stock`, 'error'); return l; }
        return { ...l, quantity: next };
      })
      .filter(l => l.quantity > 0));
  };

  const removeLine = (productId: number) => setCart(prev => prev.filter(l => l.product_id !== productId));
  const clearCart = () => {
    setCart([]); setDiscount(''); setAdditionalFee(''); setTaxPercent(''); setServiceCharge(''); setDeliveryFee('');
    setCashAmount(''); setOnlineAmount(''); setPaymentMethod('Cash'); setReferenceNo('');
  };

  const subtotal = cart.reduce((s, l) => s + l.unit_price * l.quantity, 0);
  const discountNum = parseFloat(discount) || 0;
  const feeNum = parseFloat(additionalFee) || 0;
  const taxPercentNum = parseFloat(taxPercent) || 0;
  const serviceChargeNum = parseFloat(serviceCharge) || 0;
  const deliveryFeeNum = parseFloat(deliveryFee) || 0;
  const preTax = Math.max(0, subtotal - discountNum + feeNum);
  const taxAmount = preTax * (taxPercentNum / 100);
  const total = Math.max(0, preTax + taxAmount + serviceChargeNum + deliveryFeeNum);
  const cashNum = parseFloat(cashAmount) || 0;
  const onlineNum = parseFloat(onlineAmount) || 0;
  const totalPayment = cashNum + onlineNum;
  const changeDue = totalPayment - total;
  const canCheckout = cart.length > 0 && !!businessId && totalPayment + 0.005 >= total && !submitting;

  const applyExactCash = () => setCashAmount(Math.max(0, total - onlineNum).toFixed(2));
  const addCashPreset = (amt: number) => setCashAmount(String((parseFloat(cashAmount) || 0) + amt));

  const completeSale = async () => {
    if (!canCheckout) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/pos/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: Number(businessId),
          items: cart.map(l => ({ product_id: l.product_id, quantity: l.quantity })),
          discount: discountNum, additional_fee: feeNum,
          tax_percent: taxPercentNum, service_charge: serviceChargeNum, delivery_fee: deliveryFeeNum,
          cash_amount: cashNum, online_amount: onlineNum,
          payment_method: paymentMethod, reference_no: referenceNo,
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
        <ReceiptView sale={receipt.sale} items={receipt.items}>
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
      <div className="flex items-center justify-between px-4 py-2.5 bg-white border-b border-gray-200 shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/" className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500" title="Back to Dashboard"><ArrowLeft size={18} /></Link>
          <select className="form-input py-1.5 text-sm w-auto" value={businessId} onChange={e => setBusinessId(e.target.value)}>
            {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          {businessId && <ShiftControl businessId={businessId} showToast={showToast} />}
        </div>
        <div className="flex items-center gap-3">
          {cashier && <span className="text-xs text-gray-500">Cashier: <span className="font-semibold text-gray-800">{cashier.name}</span></span>}
          <Link href="/pos/sales" className="btn-secondary text-xs py-1.5"><History size={13} /> Sales History</Link>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Product grid */}
        <div className="w-[70%] flex flex-col overflow-hidden p-4">
          <div className="relative mb-3 shrink-0">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
            <input ref={searchRef} className="form-input pl-9" placeholder="Search product or scan barcode..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="flex items-center gap-2 mb-3 flex-wrap shrink-0">
            {categoryCounts.map(c => (
              <button key={c.name} onClick={() => setCategory(c.name)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${category === c.name ? 'bg-orange-500 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-100'}`}>
                {c.name} <span className="opacity-70">({c.count})</span>
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-auto">
            {filteredProducts.length === 0 ? (
              <p className="text-center text-gray-400 text-sm py-12">No products found.</p>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2.5">
                {filteredProducts.map(p => (
                  <button key={p.id} onClick={() => addToCart(p)} disabled={p.quantity <= 0}
                    className="bg-white border border-gray-200 rounded-lg p-2.5 text-left hover:border-orange-300 hover:shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                    <p className="text-xs font-semibold text-gray-800 leading-snug line-clamp-2 min-h-[2rem]">{p.name}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{p.sku}</p>
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-xs font-bold text-orange-600 tabular-nums">{formatCurrency(p.srp ?? 0)}</span>
                      <span className={`text-[9px] font-semibold ${p.quantity <= 0 ? 'text-red-500' : p.quantity <= 5 ? 'text-amber-600' : 'text-gray-400'}`}>
                        {p.quantity <= 0 ? 'Out' : `${p.quantity} left`}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Cart / payment */}
        <div className="w-[30%] bg-white border-l border-gray-200 flex flex-col overflow-hidden shrink-0">
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
                  <div key={l.product_id} className="flex items-center gap-2 py-2 border-b border-gray-50">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-gray-800 truncate">{l.name}</p>
                      <p className="text-[11px] text-gray-400 tabular-nums">{formatCurrency(l.unit_price)} each</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => changeQty(l.product_id, -1)} className="p-1 rounded hover:bg-gray-100 text-gray-500"><Minus size={12} /></button>
                      <span className="text-xs font-semibold w-5 text-center tabular-nums">{l.quantity}</span>
                      <button onClick={() => changeQty(l.product_id, 1)} className="p-1 rounded hover:bg-gray-100 text-gray-500"><Plus size={12} /></button>
                    </div>
                    <span className="text-xs font-bold text-gray-900 w-16 text-right tabular-nums shrink-0">{formatCurrency(l.unit_price * l.quantity)}</span>
                    <button onClick={() => removeLine(l.product_id)} className="p-1 rounded hover:bg-red-50 text-gray-300 hover:text-red-500 shrink-0"><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-gray-100 px-4 py-3 space-y-3 shrink-0 overflow-y-auto max-h-[68vh]">
            {/* Additional Fee / Discounts / Tax — edited here; just displayed (read-only) in the totals box below */}
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[11px] text-gray-500 font-medium">Additional Fee</label>
                <input type="number" min="0" step="0.01" className="form-input py-1.5 text-xs" placeholder="0.00" value={additionalFee} onChange={e => setAdditionalFee(e.target.value)} />
              </div>
              <div>
                <label className="text-[11px] text-gray-500 font-medium">Discounts</label>
                <input type="number" min="0" step="0.01" className="form-input py-1.5 text-xs" placeholder="0.00" value={discount} onChange={e => setDiscount(e.target.value)} />
              </div>
              <div>
                <label className="text-[11px] text-gray-500 font-medium">Tax (%)</label>
                <input type="number" min="0" step="0.01" className="form-input py-1.5 text-xs" placeholder="0" value={taxPercent} onChange={e => setTaxPercent(e.target.value)} />
              </div>
            </div>

            {/* Totals — Service Charge/Delivery Fee are edited inline, matching the reference layout */}
            <div className="bg-emerald-500 text-white rounded-xl p-3 space-y-1.5">
              <div className="flex justify-between items-center text-xs"><span className="text-white/90">Subtotal</span><span className="tabular-nums font-semibold">{formatCurrency(subtotal)}</span></div>
              <div className="flex justify-between items-center text-xs"><span className="text-white/90">Additional Fee</span><span className="tabular-nums font-semibold">{formatCurrency(feeNum)}</span></div>
              <div className="flex justify-between items-center text-xs"><span className="text-white/90">Discounts</span><span className="tabular-nums font-semibold">-{formatCurrency(discountNum)}</span></div>
              <div className="flex justify-between items-center text-xs"><span className="text-white/90">Tax ({taxPercentNum}%)</span><span className="tabular-nums font-semibold">{formatCurrency(taxAmount)}</span></div>
              <div className="flex justify-between items-center text-xs"><span className="text-white/90">Service Charge</span><InlineField value={serviceCharge} onChange={setServiceCharge} /></div>
              <div className="flex justify-between items-center text-xs"><span className="text-white/90">Delivery Fee</span><InlineField value={deliveryFee} onChange={setDeliveryFee} /></div>
              <div className="flex justify-between items-center text-lg font-bold pt-1.5 border-t border-white/25"><span>Total</span><span className="tabular-nums">{formatCurrency(total)}</span></div>
            </div>

            {/* Cash presets */}
            <div>
              <p className="text-xs font-semibold text-gray-700 mb-1.5">Customer Payment</p>
              <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5">
                <button onClick={applyExactCash} className="px-2 py-1.5 rounded-md text-xs font-semibold border border-orange-300 text-orange-700 hover:bg-orange-50">Exact</button>
                {CASH_PRESETS.filter(a => a < 500).map(amt => (
                  <button key={amt} onClick={() => addCashPreset(amt)} className="px-2 py-1.5 rounded-md text-xs font-semibold border border-blue-200 text-blue-700 hover:bg-blue-50">{amt}</button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-1.5 mt-1.5">
                {CASH_PRESETS.filter(a => a >= 500).map(amt => (
                  <button key={amt} onClick={() => addCashPreset(amt)} className="py-2 rounded-md text-sm font-bold border border-blue-200 text-blue-700 hover:bg-blue-50">{amt}</button>
                ))}
              </div>
            </div>

            {/* Payment box */}
            <div className="bg-blue-500 text-white rounded-xl p-3 space-y-1.5">
              <div className="flex justify-between items-center text-xs"><span className="text-white/90">Customer's Payment Cash</span><InlineField value={cashAmount} onChange={setCashAmount} /></div>
              <div className="flex justify-between items-center text-xs"><span className="text-white/90">Customer's Payment Online</span><InlineField value={onlineAmount} onChange={setOnlineAmount} /></div>
              <div className="flex justify-between items-center text-sm pt-1"><span className="text-white/90">Total Payment</span><span className="font-semibold tabular-nums">{formatCurrency(totalPayment)}</span></div>
              <div className="flex justify-between items-center text-xs"><span className="text-white/90">Total Bill</span><span className="tabular-nums">-{formatCurrency(total)}</span></div>
              <div className="flex justify-between items-center text-lg font-bold pt-1"><span>Change</span><span className={`tabular-nums ${changeDue < 0 ? 'text-red-200' : ''}`}>{formatCurrency(Math.max(0, changeDue))}</span></div>
            </div>

            <div>
              <label className="text-[11px] text-gray-500 font-medium">Reference No. (Optional)</label>
              <input className="form-input py-1.5 text-sm" placeholder="Input reference number here" value={referenceNo} onChange={e => setReferenceNo(e.target.value)} />
            </div>

            <div>
              <p className="text-xs font-semibold text-gray-700 mb-1.5">Payment Method</p>
              <div className="space-y-1.5">
                <div className="grid grid-cols-4 gap-1.5">
                  {PAYMENT_METHOD_GROUPS[0].map(m => {
                    const Icon = PAYMENT_METHOD_ICONS[m];
                    return (
                      <button key={m} onClick={() => setPaymentMethod(m)}
                        className={`flex flex-col items-center gap-1 py-2.5 rounded-lg border transition-all ${paymentMethod === m ? 'bg-blue-50 border-blue-500' : 'bg-gray-50 border-gray-200 hover:bg-gray-100'}`}>
                        <Icon size={18} className={paymentMethod === m ? 'text-blue-600' : 'text-gray-500'} />
                        <span className={`text-[11px] font-semibold text-center leading-tight ${paymentMethod === m ? 'text-blue-700' : 'text-gray-600'}`}>{m}</span>
                      </button>
                    );
                  })}
                </div>
                {PAYMENT_METHOD_GROUPS[1].map(m => {
                  const Icon = PAYMENT_METHOD_ICONS[m];
                  return (
                    <button key={m} onClick={() => setPaymentMethod(m)}
                      className={`w-full flex flex-col items-center gap-1 py-3 rounded-lg border transition-all ${paymentMethod === m ? 'bg-blue-50 border-blue-500' : 'bg-gray-50 border-gray-200 hover:bg-gray-100'}`}>
                      <Icon size={20} className={paymentMethod === m ? 'text-blue-600' : 'text-gray-500'} />
                      <span className={`text-[11px] font-semibold ${paymentMethod === m ? 'text-blue-700' : 'text-gray-600'}`}>{m}</span>
                    </button>
                  );
                })}
                <div className="grid grid-cols-5 gap-1.5">
                  {PAYMENT_METHOD_GROUPS[2].map(m => {
                    const Icon = PAYMENT_METHOD_ICONS[m];
                    return (
                      <button key={m} onClick={() => setPaymentMethod(m)}
                        className={`flex flex-col items-center gap-1 py-2.5 rounded-lg border transition-all ${paymentMethod === m ? 'bg-blue-50 border-blue-500' : 'bg-gray-50 border-gray-200 hover:bg-gray-100'}`}>
                        <Icon size={18} className={paymentMethod === m ? 'text-blue-600' : 'text-gray-500'} />
                        <span className={`text-[11px] font-semibold text-center leading-tight ${paymentMethod === m ? 'text-blue-700' : 'text-gray-600'}`}>{m}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <button onClick={completeSale} disabled={!canCheckout} className="btn-primary w-full justify-center py-3 text-sm disabled:opacity-40">
              {submitting ? 'Processing...' : 'Place Order'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
