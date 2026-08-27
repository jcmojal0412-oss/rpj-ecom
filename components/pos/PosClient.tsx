'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { Search, Plus, Minus, Trash2, ArrowLeft, History, Printer, ScanBarcode, RotateCw } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { Toast, useToast } from '@/components/ui/Toast';
import Spinner from '@/components/ui/Spinner';
import ReceiptView from './ReceiptView';
import { CASH_PRESETS, PAYMENT_METHODS, type Business, type Product, type CartLine, type Sale, type SaleItem } from './constants';

interface SessionUser { id: number; name: string; }

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
        </div>
        <div className="flex items-center gap-3">
          {cashier && <span className="text-xs text-gray-500">Cashier: <span className="font-semibold text-gray-800">{cashier.name}</span></span>}
          <Link href="/pos/sales" className="btn-secondary text-xs py-1.5"><History size={13} /> Sales History</Link>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Product grid */}
        <div className="flex-1 flex flex-col overflow-hidden p-4">
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
        <div className="w-[400px] bg-white border-l border-gray-200 flex flex-col overflow-hidden shrink-0">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
            <p className="text-sm font-semibold text-gray-800">Current Order</p>
            <div className="flex items-center gap-1">
              <button onClick={() => searchRef.current?.focus()} title="Scan/search barcode" className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"><ScanBarcode size={14} /></button>
              <button onClick={loadProducts} title="Refresh products" className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"><RotateCw size={14} /></button>
              {cart.length > 0 && <button onClick={clearCart} className="text-xs text-red-500 hover:text-red-700 font-medium px-1.5">Clear All</button>}
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

          <div className="border-t border-gray-100 px-4 py-3 space-y-2 shrink-0 overflow-y-auto max-h-[62vh]">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] text-gray-500 font-medium">Discount (₱)</label>
                <input type="number" min="0" step="0.01" className="form-input py-1.5 text-sm" placeholder="0.00" value={discount} onChange={e => setDiscount(e.target.value)} />
              </div>
              <div>
                <label className="text-[11px] text-gray-500 font-medium">Additional Fee (₱)</label>
                <input type="number" min="0" step="0.01" className="form-input py-1.5 text-sm" placeholder="0.00" value={additionalFee} onChange={e => setAdditionalFee(e.target.value)} />
              </div>
              <div>
                <label className="text-[11px] text-gray-500 font-medium">Tax (%)</label>
                <input type="number" min="0" step="0.01" className="form-input py-1.5 text-sm" placeholder="0" value={taxPercent} onChange={e => setTaxPercent(e.target.value)} />
              </div>
              <div>
                <label className="text-[11px] text-gray-500 font-medium">Service Charge (₱)</label>
                <input type="number" min="0" step="0.01" className="form-input py-1.5 text-sm" placeholder="0.00" value={serviceCharge} onChange={e => setServiceCharge(e.target.value)} />
              </div>
              <div className="col-span-2">
                <label className="text-[11px] text-gray-500 font-medium">Delivery Fee (₱)</label>
                <input type="number" min="0" step="0.01" className="form-input py-1.5 text-sm" placeholder="0.00" value={deliveryFee} onChange={e => setDeliveryFee(e.target.value)} />
              </div>
            </div>

            <div className="bg-gray-900 text-white rounded-xl p-3 space-y-1">
              <div className="flex justify-between text-xs text-gray-300"><span>Subtotal</span><span className="tabular-nums">{formatCurrency(subtotal)}</span></div>
              {discountNum > 0 && <div className="flex justify-between text-xs text-gray-300"><span>Discount</span><span className="tabular-nums">-{formatCurrency(discountNum)}</span></div>}
              {feeNum > 0 && <div className="flex justify-between text-xs text-gray-300"><span>Additional Fee</span><span className="tabular-nums">{formatCurrency(feeNum)}</span></div>}
              {taxAmount > 0 && <div className="flex justify-between text-xs text-gray-300"><span>Tax ({taxPercentNum}%)</span><span className="tabular-nums">{formatCurrency(taxAmount)}</span></div>}
              {serviceChargeNum > 0 && <div className="flex justify-between text-xs text-gray-300"><span>Service Charge</span><span className="tabular-nums">{formatCurrency(serviceChargeNum)}</span></div>}
              {deliveryFeeNum > 0 && <div className="flex justify-between text-xs text-gray-300"><span>Delivery Fee</span><span className="tabular-nums">{formatCurrency(deliveryFeeNum)}</span></div>}
              <div className="flex justify-between text-base font-bold pt-1"><span>Total</span><span className="tabular-nums">{formatCurrency(total)}</span></div>
            </div>

            <div>
              <label className="text-[11px] text-gray-500 font-medium">Cash</label>
              <input type="number" min="0" step="0.01" className="form-input py-1.5 text-sm" placeholder="0.00" value={cashAmount} onChange={e => setCashAmount(e.target.value)} />
              <div className="flex items-center gap-1 mt-1 flex-wrap">
                <button onClick={applyExactCash} className="px-2 py-1 rounded-md text-[11px] font-semibold bg-orange-50 text-orange-700 hover:bg-orange-100">Exact</button>
                {CASH_PRESETS.map(amt => (
                  <button key={amt} onClick={() => addCashPreset(amt)} className="px-2 py-1 rounded-md text-[11px] font-semibold bg-gray-100 text-gray-600 hover:bg-gray-200">+{amt}</button>
                ))}
                <button onClick={() => setCashAmount('')} className="px-2 py-1 rounded-md text-[11px] font-semibold text-gray-400 hover:text-gray-600">Clear</button>
              </div>
            </div>
            <div>
              <label className="text-[11px] text-gray-500 font-medium">Online (GCash / Maya / Bank)</label>
              <input type="number" min="0" step="0.01" className="form-input py-1.5 text-sm" placeholder="0.00" value={onlineAmount} onChange={e => setOnlineAmount(e.target.value)} />
            </div>

            <div className="flex justify-between text-sm pt-1">
              <span className="text-gray-500">Total Payment</span>
              <span className="font-semibold text-gray-800 tabular-nums">{formatCurrency(totalPayment)}</span>
            </div>
            <div className="flex justify-between text-base">
              <span className="font-semibold text-gray-700">Change</span>
              <span className={`font-bold tabular-nums ${changeDue < 0 ? 'text-red-500' : 'text-green-600'}`}>{formatCurrency(Math.max(0, changeDue))}</span>
            </div>

            <div>
              <label className="text-[11px] text-gray-500 font-medium">Reference No. (Optional)</label>
              <input className="form-input py-1.5 text-sm" placeholder="e.g. GCash reference number" value={referenceNo} onChange={e => setReferenceNo(e.target.value)} />
            </div>

            <div>
              <label className="text-[11px] text-gray-500 font-medium">Payment Method</label>
              <div className="grid grid-cols-3 gap-1.5 mt-1">
                {PAYMENT_METHODS.map(m => (
                  <button key={m} onClick={() => setPaymentMethod(m)}
                    className={`px-2 py-1.5 rounded-lg text-[11px] font-semibold border transition-all ${paymentMethod === m ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                    {m}
                  </button>
                ))}
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
