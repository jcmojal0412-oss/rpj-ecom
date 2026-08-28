'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Search, RotateCcw, Repeat, Minus, Plus, ReceiptText, Printer, CheckCircle2 } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import RefundModal from './RefundModal';
import ReturnExchangeReceipt, { type ReturnedItem } from './ReturnExchangeReceipt';
import type { Sale, SaleItem, Refund, Product } from './constants';
import { REFUND_METHODS, displayReceiptNo } from './constants';

const ONLINE_PROVIDERS = ['GCash', 'Maya', 'Sodexo', 'Bank Transfer'];
type PayMode = 'Cash' | 'Online' | 'Card' | 'Split';

interface Props {
  businessId: string;
  cashierName: string;
  showToast: (msg: string, type?: 'success' | 'error') => void;
  onDone: () => void;
}

interface FoundSale { sale: Sale; items: SaleItem[]; refunds: Refund[]; }

export default function ReturnExchangeClient({ cashierName, showToast, onDone }: Props) {
  const [step, setStep] = useState<'find' | 'action' | 'refund' | 'exchange'>('find');
  const [saleNumberInput, setSaleNumberInput] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [found, setFound] = useState<FoundSale | null>(null);

  const findSale = async () => {
    const raw = saleNumberInput.replace(/\s+/g, '');
    if (!raw) { setSearchError('Enter a valid Sale # / Receipt #'); return; }
    setSearching(true);
    setSearchError('');
    try {
      let id: number | null = null;
      // New-style receipt numbers ("BNS108") are letters followed by digits —
      // resolve those through the receipt_no lookup. Anything else (a bare
      // number, or the old padded "Sale #000046" label pasted verbatim) is
      // treated as the internal Sale # — non-digit characters stripped
      // before parsing.
      if (/^[A-Za-z]+\d+$/.test(raw)) {
        const res = await fetch(`/api/pos/sales?receipt_no=${encodeURIComponent(raw.toUpperCase())}`);
        const data = await res.json();
        const match = (data.rows ?? [])[0];
        if (!match) { setSearchError('Sale not found'); return; }
        id = match.id;
      } else {
        id = parseInt(raw.replace(/\D/g, ''), 10);
      }
      if (!id || id <= 0) { setSearchError('Enter a valid Sale # / Receipt #'); return; }
      const res = await fetch(`/api/pos/sales/${id}`);
      const data = await res.json();
      if (!res.ok) { setSearchError(data.error || 'Sale not found'); return; }
      if (data.sale.status === 'Voided') { setSearchError('This sale was voided and cannot be returned or exchanged.'); return; }
      setFound(data);
      setStep('action');
    } catch {
      setSearchError('Failed to look up sale');
    } finally {
      setSearching(false);
    }
  };

  const reset = () => {
    setFound(null);
    setSaleNumberInput('');
    setSearchError('');
    setStep('find');
  };

  const refundableItems = useMemo(() => {
    if (!found) return [];
    const refundedMap = new Map<number, number>();
    for (const r of found.refunds) for (const it of r.items) {
      refundedMap.set(it.sale_item_id, (refundedMap.get(it.sale_item_id) ?? 0) + it.quantity);
    }
    return found.items.map(it => ({ ...it, remaining: it.quantity - (refundedMap.get(it.id) ?? 0) }));
  }, [found]);

  const hasFreebies = found?.items.some(it => !!it.is_freebie) ?? false;

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="flex items-center gap-2 mb-5">
        <button onClick={onDone} className="p-1.5 rounded-lg hover:bg-white text-gray-500" title="Back to Sale"><ArrowLeft size={18} /></button>
        <h1 className="text-base font-bold text-gray-800">Return / Exchange</h1>
      </div>

      {step === 'find' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-md">
          <label className="form-label">Find Original Sale</label>
          <p className="text-xs text-gray-400 mb-2">Search by Sale # / Receipt #</p>
          <div className="flex gap-2">
            <input
              className="form-input" placeholder="e.g. BNS108" autoFocus value={saleNumberInput}
              onChange={e => setSaleNumberInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') findSale(); }}
            />
            <button onClick={findSale} disabled={searching} className="btn-primary shrink-0 disabled:opacity-50">
              <Search size={14} /> {searching ? 'Searching...' : 'Find'}
            </button>
          </div>
          {searchError && <p className="text-xs text-red-600 mt-2">{searchError}</p>}
        </div>
      )}

      {step !== 'find' && found && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ReceiptText size={16} className="text-gray-400" />
                <p className="text-sm font-bold text-gray-800">{displayReceiptNo(found.sale)}</p>
                <span className="text-xs text-gray-400">{formatDate(found.sale.created_at)}</span>
              </div>
              <button onClick={reset} className="text-xs text-gray-500 hover:text-gray-700 underline">Search another sale</button>
            </div>
            <div className="mt-3 space-y-1">
              {found.items.map(it => (
                <div key={it.id} className="flex justify-between text-xs text-gray-600">
                  <span>{it.product_name} {it.is_freebie ? <span className="text-orange-600 font-semibold">(FREEBIE)</span> : null} × {it.quantity}</span>
                  <span className="tabular-nums">{formatCurrency(it.line_total)}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-between text-sm font-bold text-gray-900 border-t border-gray-100 mt-2 pt-2">
              <span>Total</span><span className="tabular-nums">{formatCurrency(found.sale.total)}</span>
            </div>
          </div>

          {step === 'action' && (
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setStep('refund')}
                className="bg-white border-2 border-red-200 hover:border-red-400 rounded-xl p-5 text-left transition-all">
                <RotateCcw size={20} className="text-red-500 mb-2" />
                <p className="text-sm font-bold text-gray-800">Refund</p>
                <p className="text-xs text-gray-400 mt-0.5">Return item(s) and pay back the customer</p>
              </button>
              <button onClick={() => setStep('exchange')}
                className="bg-white border-2 border-blue-200 hover:border-blue-400 rounded-xl p-5 text-left transition-all">
                <Repeat size={20} className="text-blue-500 mb-2" />
                <p className="text-sm font-bold text-gray-800">Exchange / Upgrade</p>
                <p className="text-xs text-gray-400 mt-0.5">Trade an item for a different product</p>
              </button>
            </div>
          )}

          {step === 'refund' && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <RefundModal
                sale={found.sale}
                items={found.items}
                refunds={found.refunds}
                cashierName={cashierName}
                onCancel={() => setStep('action')}
                onRefunded={() => { showToast('Refund processed', 'success'); onDone(); }}
              />
            </div>
          )}

          {step === 'exchange' && (
            <ExchangeFlow
              sale={found.sale}
              refundableItems={refundableItems}
              hasFreebies={hasFreebies}
              cashierName={cashierName}
              onBack={() => setStep('action')}
              onDone={() => { showToast('Exchange completed', 'success'); onDone(); }}
            />
          )}
        </div>
      )}
    </div>
  );
}

interface RefundableItem extends SaleItem { remaining: number; }

function ExchangeFlow({ sale, refundableItems, hasFreebies, cashierName, onBack, onDone }: {
  sale: Sale;
  refundableItems: RefundableItem[];
  hasFreebies: boolean;
  cashierName: string;
  onBack: () => void;
  onDone: () => void;
}) {
  const sellable = refundableItems.filter(it => it.remaining > 0 && !it.is_freebie);
  const [selectedId, setSelectedId] = useState<number | null>(sellable[0]?.id ?? null);
  const [returnQty, setReturnQty] = useState(1);
  const [condition, setCondition] = useState<'Sellable' | 'Defective'>('Sellable');
  const [freebiesReturned, setFreebiesReturned] = useState<'YES' | 'NO' | null>(null);

  const [products, setProducts] = useState<Product[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [newProduct, setNewProduct] = useState<Product | null>(null);

  const [reason, setReason] = useState('');
  const [referenceNo, setReferenceNo] = useState('');
  const [paymentMode, setPaymentMode] = useState<PayMode>('Cash');
  const [onlineProvider, setOnlineProvider] = useState(ONLINE_PROVIDERS[0]);
  const [cashAmount, setCashAmount] = useState('');
  const [onlineAmount, setOnlineAmount] = useState('');
  const [excessRefundMethod, setExcessRefundMethod] = useState('Cash');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [completed, setCompleted] = useState<{
    refundId: number; returnedItem: ReturnedItem; newItemName: string; newItemPrice: number;
    amountPaid: number; paymentMethod?: string; refundDifference: number; excessRefundMethod?: string;
  } | null>(null);

  useEffect(() => {
    fetch('/api/pos/products').then(r => r.json()).then(d => setProducts(d.rows ?? []));
  }, []);

  const selected = sellable.find(it => it.id === selectedId) ?? null;
  const maxQty = selected?.remaining ?? 1;

  const returnValue = selected ? selected.unit_price * returnQty : 0;
  const newUnitPrice = newProduct?.srp ?? 0;
  const amountToPay = Math.max(0, newUnitPrice - returnValue);
  const excess = Math.max(0, returnValue - newUnitPrice);

  const cashNum = parseFloat(cashAmount) || 0;
  const onlineNum = parseFloat(onlineAmount) || 0;
  const totalPayment =
    paymentMode === 'Cash' ? cashNum :
    paymentMode === 'Split' ? cashNum + onlineNum :
    onlineNum;
  const changeDue = amountToPay > 0 ? totalPayment - amountToPay : 0;

  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    let rows = products.filter(p => p.quantity > 0);
    if (q) rows = rows.filter(p => p.name.toLowerCase().includes(q) || (p.sku ?? '').toLowerCase().includes(q));
    return rows.slice(0, 24);
  }, [products, productSearch]);

  const setExactCash = () => setCashAmount(amountToPay.toFixed(2));

  const canSubmit =
    !!selected && returnQty > 0 && returnQty <= maxQty && !!newProduct &&
    (amountToPay <= 0 || totalPayment + 0.005 >= amountToPay) &&
    (excess <= 0 || !!excessRefundMethod) &&
    !submitting;

  const submit = async () => {
    if (!selected || !newProduct) return;
    setError('');
    setSubmitting(true);
    try {
      const payment_method =
        amountToPay <= 0 ? undefined :
        paymentMode === 'Split' ? `Cash + ${onlineProvider}` :
        paymentMode === 'Cash' ? 'Cash' :
        paymentMode === 'Card' ? 'Credit Card' : onlineProvider;

      const res = await fetch(`/api/pos/sales/${sale.id}/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          return_item: { sale_item_id: selected.id, quantity: returnQty, condition },
          new_product_id: newProduct.id,
          cash_amount: paymentMode === 'Cash' || paymentMode === 'Split' ? cashNum : 0,
          online_amount: paymentMode === 'Online' || paymentMode === 'Card' || paymentMode === 'Split' ? onlineNum : 0,
          reference_no: referenceNo,
          refund_method: excess > 0 ? excessRefundMethod : undefined,
          reason,
          freebies_returned: hasFreebies ? freebiesReturned : null,
          payment_method,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to process exchange'); return; }
      setCompleted({
        refundId: data.refund_id,
        returnedItem: { name: selected.product_name, quantity: returnQty, unitPrice: selected.unit_price, condition },
        newItemName: newProduct.name, newItemPrice: newUnitPrice,
        amountPaid: data.amount_to_pay ?? amountToPay,
        paymentMethod: payment_method,
        refundDifference: data.excess ?? excess,
        excessRefundMethod: excess > 0 ? excessRefundMethod : undefined,
      });
    } catch {
      setError('Failed to process exchange');
    } finally {
      setSubmitting(false);
    }
  };

  if (completed) {
    const isUpgrade = completed.amountPaid > 0;
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <div className="flex items-center gap-2 justify-center text-green-600">
          <CheckCircle2 size={18} />
          <p className="text-sm font-bold">{isUpgrade ? 'UPGRADE SUCCESSFUL' : 'EXCHANGE SUCCESSFUL'}</p>
        </div>
        <ReturnExchangeReceipt
          kind="exchange"
          businessName={sale.business_name || 'RPJ ECOM'}
          cashierName={cashierName}
          date={formatDate(new Date().toISOString())}
          refundId={completed.refundId}
          originalReceiptNo={displayReceiptNo(sale)}
          returnedItems={[completed.returnedItem]}
          reason={reason.trim() || undefined}
          hasFreebiesOnOriginal={hasFreebies}
          freebiesReturned={hasFreebies ? freebiesReturned : null}
          newItemName={completed.newItemName}
          newItemPrice={completed.newItemPrice}
          amountPaid={completed.amountPaid}
          paymentMethod={completed.paymentMethod}
          refundDifference={completed.refundDifference}
          excessRefundMethod={completed.excessRefundMethod}
        />
        <div className="flex justify-center gap-3 pt-2">
          <button onClick={() => window.print()} className="btn-secondary"><Printer size={15} /> Print</button>
          <button onClick={onDone} className="btn-primary">New Sale</button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-5">
      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}

      <div>
        <label className="form-label">1. Item Being Returned</label>
        {sellable.length === 0 ? (
          <p className="text-xs text-gray-400">No sellable items left to return on this sale.</p>
        ) : (
          <div className="space-y-1.5">
            {sellable.map(it => (
              <label key={it.id} className={`flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer ${selectedId === it.id ? 'border-blue-400 bg-blue-50' : 'border-gray-200'}`}>
                <input type="radio" checked={selectedId === it.id} onChange={() => { setSelectedId(it.id); setReturnQty(1); }} />
                <span className="flex-1 text-sm text-gray-700">{it.product_name} <span className="text-gray-400">· {formatCurrency(it.unit_price)} each · {it.remaining} available</span></span>
              </label>
            ))}
          </div>
        )}
        {selected && (
          <div className="flex items-center justify-between mt-2">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-500">Qty:</span>
              <button type="button" onClick={() => setReturnQty(q => Math.max(1, q - 1))} className="p-1 rounded hover:bg-gray-100 text-gray-500"><Minus size={12} /></button>
              <span className="text-sm font-semibold w-6 text-center tabular-nums">{returnQty}</span>
              <button type="button" onClick={() => setReturnQty(q => Math.min(maxQty, q + 1))} className="p-1 rounded hover:bg-gray-100 text-gray-500"><Plus size={12} /></button>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-500">Condition:</span>
              {(['Sellable', 'Defective'] as const).map(c => (
                <button key={c} type="button" onClick={() => setCondition(c)}
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${condition === c ? (c === 'Sellable' ? 'bg-green-50 border-green-400 text-green-700' : 'bg-amber-50 border-amber-400 text-amber-700') : 'bg-white border-gray-200 text-gray-500'}`}>
                  {c}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {hasFreebies && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <p className="text-xs font-medium text-amber-800">This sale included a promo freebie. Were the freebie item(s) also returned?</p>
          <div className="flex gap-2 mt-2">
            {(['YES', 'NO'] as const).map(v => (
              <button key={v} type="button" onClick={() => setFreebiesReturned(v)}
                className={`px-3 py-1 rounded-md text-xs font-semibold border ${freebiesReturned === v ? 'bg-amber-500 border-amber-500 text-white' : 'bg-white border-amber-300 text-amber-700'}`}>
                {v}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <label className="form-label">2. New / Replacement Product</label>
        <div className="relative mb-2">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
          <input className="form-input pl-8 text-sm" placeholder="Search product..." value={productSearch} onChange={e => setProductSearch(e.target.value)} />
        </div>
        {newProduct ? (
          <div className="flex items-center justify-between bg-blue-50 border border-blue-300 rounded-lg px-3 py-2">
            <div>
              <p className="text-sm font-semibold text-gray-800">{newProduct.name}</p>
              <p className="text-xs text-gray-500">{newProduct.sku} · {formatCurrency(newProduct.srp ?? 0)}</p>
            </div>
            <button onClick={() => setNewProduct(null)} className="text-xs text-blue-600 hover:underline">Change</button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-auto">
            {filteredProducts.map(p => (
              <button key={p.id} onClick={() => setNewProduct(p)}
                className="text-left bg-gray-50 hover:bg-blue-50 border border-gray-200 hover:border-blue-300 rounded-lg p-2 transition-all">
                <p className="text-xs font-semibold text-gray-800 line-clamp-2">{p.name}</p>
                <p className="text-[10px] text-gray-400">{p.sku}</p>
                <p className="text-xs font-bold text-blue-600 tabular-nums mt-0.5">{formatCurrency(p.srp ?? 0)}</p>
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && newProduct && (
        <div className="bg-gray-50 rounded-lg p-3 space-y-1">
          <div className="flex justify-between text-sm"><span className="text-gray-500">Return Value</span><span className="tabular-nums font-medium">{formatCurrency(returnValue)}</span></div>
          <div className="flex justify-between text-sm"><span className="text-gray-500">New Item Price</span><span className="tabular-nums font-medium">{formatCurrency(newUnitPrice)}</span></div>
          <div className="flex justify-between text-sm font-bold border-t border-gray-200 pt-1">
            {excess > 0
              ? <><span className="text-green-700">Excess (Refund to Customer)</span><span className="tabular-nums text-green-700">{formatCurrency(excess)}</span></>
              : <><span className="text-gray-900">Amount to Pay</span><span className="tabular-nums text-gray-900">{formatCurrency(amountToPay)}</span></>}
          </div>
        </div>
      )}

      {excess > 0 && (
        <div>
          <label className="form-label">Refund Excess Via</label>
          <div className="grid grid-cols-3 gap-1.5">
            {REFUND_METHODS.map(m => (
              <button key={m} type="button" onClick={() => setExcessRefundMethod(m)}
                className={`px-2 py-1.5 rounded-md text-xs font-semibold border transition-all ${excessRefundMethod === m ? 'bg-green-50 border-green-400 text-green-700' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                {m}
              </button>
            ))}
          </div>
        </div>
      )}

      {amountToPay > 0 && (
        <div>
          <label className="form-label">3. Payment for Amount to Pay</label>
          <div className="grid grid-cols-4 gap-1.5 mb-2">
            {(['Cash', 'Online', 'Card', 'Split'] as const).map(m => (
              <button key={m} type="button" onClick={() => setPaymentMode(m)}
                className={`px-2 py-1.5 rounded-md text-xs font-semibold border transition-all ${paymentMode === m ? 'bg-blue-50 border-blue-400 text-blue-700' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                {m === 'Online' ? 'ONLINE/QR' : m.toUpperCase()}
              </button>
            ))}
          </div>

          {(paymentMode === 'Online' || paymentMode === 'Split') && (
            <div className="flex gap-1.5 mb-2">
              {ONLINE_PROVIDERS.map(p => (
                <button key={p} type="button" onClick={() => setOnlineProvider(p)}
                  className={`px-2 py-1 rounded text-[10px] font-semibold border ${onlineProvider === p ? 'bg-blue-500 border-blue-500 text-white' : 'bg-white border-gray-200 text-gray-500'}`}>
                  {p}
                </button>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            {(paymentMode === 'Cash' || paymentMode === 'Split') && (
              <div>
                <label className="text-[10px] text-gray-400">Cash Received</label>
                <div className="flex gap-1">
                  <input type="number" min="0" step="0.01" className="form-input text-sm" placeholder="0.00" value={cashAmount} onChange={e => setCashAmount(e.target.value)} />
                  {paymentMode === 'Cash' && <button type="button" onClick={setExactCash} className="btn-secondary text-[10px] px-2 shrink-0">Exact</button>}
                </div>
              </div>
            )}
            {(paymentMode === 'Online' || paymentMode === 'Card' || paymentMode === 'Split') && (
              <div>
                <label className="text-[10px] text-gray-400">{paymentMode === 'Card' ? 'Card Amount' : 'Online Amount'}</label>
                <input type="number" min="0" step="0.01" className="form-input text-sm" placeholder="0.00" value={onlineAmount} onChange={e => setOnlineAmount(e.target.value)} />
              </div>
            )}
          </div>
          {(paymentMode === 'Online' || paymentMode === 'Card' || paymentMode === 'Split') && (
            <input className="form-input text-sm mt-2" placeholder="Reference No. (optional)" value={referenceNo} onChange={e => setReferenceNo(e.target.value)} />
          )}

          <div className="bg-blue-500 text-white rounded-xl p-3 space-y-1 mt-3">
            <div className="flex justify-between items-center text-xs"><span className="text-white/80">Amount to Pay</span><span className="font-semibold tabular-nums">{formatCurrency(amountToPay)}</span></div>
            <div className="flex justify-between items-center text-xs"><span className="text-white/80">Total Payment</span><span className="font-semibold tabular-nums">{formatCurrency(totalPayment)}</span></div>
            <div className="flex justify-between items-center text-sm font-bold pt-1 border-t border-white/25">
              <span>{changeDue >= 0 ? 'Change' : 'Remaining'}</span>
              <span className="tabular-nums">{formatCurrency(Math.abs(changeDue))}</span>
            </div>
          </div>
        </div>
      )}

      <div>
        <label className="form-label">Reason (Optional)</label>
        <input className="form-input" placeholder="e.g. Size upgrade, changed mind" value={reason} onChange={e => setReason(e.target.value)} />
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button onClick={onBack} className="btn-secondary">Back</button>
        <button onClick={submit} disabled={!canSubmit} className="btn-primary disabled:opacity-40">
          {submitting ? 'Processing...' : 'Complete Exchange'}
        </button>
      </div>
    </div>
  );
}
