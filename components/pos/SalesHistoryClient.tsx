'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { ArrowLeft, Eye, Ban, Undo2, UploadCloud, Search, PackageCheck } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import Spinner from '@/components/ui/Spinner';
import { Toast, useToast } from '@/components/ui/Toast';
import Modal from '@/components/ui/Modal';
import { DATE_PRESETS, resolvePresetRange, type DatePreset } from '@/components/expenses/dateRanges';
import ReceiptView from './ReceiptView';
import RefundModal from './RefundModal';
import ReleaseItemModal from './ReleaseItemModal';
import { displayReceiptNo, derivePaymentStatus, type Business, type Sale, type SaleItem, type Refund } from './constants';

type SaleDetail = { sale: Sale; items: SaleItem[]; refunds: Refund[]; payments?: { method: string; amount: number; reference_no: string | null }[] };

export default function SalesHistoryClient() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);

  // Defaults to Today — "All Dates" pulls the entire sales history with no
  // limit, which gets slow to load as the table grows. Still one click away.
  const [preset, setPreset] = useState<DatePreset | null>('Today');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [businessId, setBusinessId] = useState('');
  const [status, setStatus] = useState('');
  const [fulfillmentFilter, setFulfillmentFilter] = useState('');
  const [q, setQ] = useState('');

  const [viewing, setViewing] = useState<SaleDetail | null>(null);
  const [voiding, setVoiding] = useState<Sale | null>(null);
  const [voidBusy, setVoidBusy] = useState(false);
  const [refunding, setRefunding] = useState<SaleDetail | null>(null);
  const [releasing, setReleasing] = useState<SaleDetail | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [cashierName, setCashierName] = useState('—');
  const { toast, showToast, clearToast } = useToast();

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(u => { if (u) { setIsOwner(u.role === 'owner'); setCashierName(u.name || '—'); } });
  }, []);

  const range = preset ? resolvePresetRange(preset, customFrom, customTo) : null;

  // Guards against a race between quick filter changes — see
  // DiscountReportClient.tsx for the full explanation.
  const fetchTicket = useRef(0);
  const fetchSales = useCallback(async () => {
    const ticket = ++fetchTicket.current;
    setLoading(true);
    const params = new URLSearchParams();
    if (range) { params.set('from', range.from); params.set('to', range.to); }
    if (businessId) params.set('business_id', businessId);
    if (status) params.set('status', status);
    if (fulfillmentFilter) params.set('fulfillment_status', fulfillmentFilter);
    if (q.trim()) params.set('q', q.trim());
    const data = await fetch(`/api/pos/sales?${params.toString()}`).then(r => r.json());
    if (ticket !== fetchTicket.current) return;
    setSales(data.rows ?? []);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, customFrom, customTo, businessId, status, fulfillmentFilter, q]);

  useEffect(() => { fetchSales(); }, [fetchSales]);
  useEffect(() => {
    fetch('/api/businesses').then(r => r.json()).then(d => setBusinesses(d.rows ?? []));
  }, []);

  const fetchDetail = (id: number): Promise<SaleDetail> => fetch(`/api/pos/sales/${id}`).then(r => r.json());

  const openSale = async (s: Sale) => setViewing(await fetchDetail(s.id));
  const openRefund = async (s: Sale) => setRefunding(await fetchDetail(s.id));
  const openRelease = async (s: Sale) => setReleasing(await fetchDetail(s.id));

  const [approvingFinancing, setApprovingFinancing] = useState(false);
  const approveFinancing = async () => {
    if (!viewing) return;
    setApprovingFinancing(true);
    try {
      const res = await fetch(`/api/pos/sales/${viewing.sale.id}/financing-status`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approval_status: 'Approved' }),
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.error || 'Failed to approve financing', 'error'); return; }
      showToast('Financing approved');
      setViewing(await fetchDetail(viewing.sale.id));
    } finally {
      setApprovingFinancing(false);
    }
  };

  const confirmVoid = async () => {
    if (!voiding) return;
    setVoidBusy(true);
    try {
      const res = await fetch(`/api/pos/sales/${voiding.id}/void`, { method: 'PUT' });
      const data = await res.json();
      if (!res.ok) { showToast(data.error || 'Failed to void sale', 'error'); return; }
      showToast('Sale voided — stock restored');
      setVoiding(null);
      setViewing(null);
      fetchSales();
    } finally {
      setVoidBusy(false);
    }
  };

  const totalSales = sales.filter(s => s.status !== 'Voided').reduce((s, sale) => s + sale.total, 0);

  // Cash Applied is what actually applied to the sale (customer-tendered
  // amount minus change), not the raw amount the customer handed over —
  // showing the tendered amount here would overstate cash collected on
  // every cash sale with change. Online absorbs any leftover change only in
  // the rare case where the cash leg alone can't cover it — same formula
  // used by the Cashier's Report.
  const cashApplied = (s: Sale) => Math.max(0, s.cash_amount - s.change_due);
  const onlineApplied = (s: Sale) => Math.max(0, s.online_amount - Math.max(0, s.change_due - s.cash_amount));

  // Shared by the desktop table row and the phone card so both always offer
  // exactly the same actions; `big` only enlarges the tap targets.
  const rowActions = (s: Sale, big: boolean) => {
    const pad = big ? 'p-2.5' : 'p-1.5';
    const iconSize = big ? 18 : 14;
    return (
      <div className="flex items-center gap-1">
        <button onClick={() => openSale(s)} className={`${pad} rounded-lg hover:bg-blue-50 text-blue-600`} title="View Receipt"><Eye size={iconSize} /></button>
        {s.status !== 'Voided' && s.fulfillment_status === 'FOR_PICKUP' && (
          <button onClick={() => openRelease(s)} className={`${pad} rounded-lg hover:bg-blue-50 ${big ? 'text-blue-600' : 'text-gray-300 hover:text-blue-600'}`} title="Release Item"><PackageCheck size={iconSize} /></button>
        )}
        {s.status !== 'Voided' && (
          <>
            <button onClick={() => openRefund(s)} className={`${pad} rounded-lg hover:bg-amber-50 ${big ? 'text-amber-600' : 'text-gray-300 hover:text-amber-600'}`} title="Refund Item(s)"><Undo2 size={iconSize} /></button>
            {isOwner && (
              <button onClick={() => setVoiding(s)} className={`${pad} rounded-lg hover:bg-red-50 ${big ? 'text-red-500' : 'text-gray-300 hover:text-red-500'}`} title="Void Sale (Owner only)"><Ban size={iconSize} /></button>
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="p-3 sm:p-4 lg:p-6 space-y-4">
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Link href="/pos" className="p-2 lg:p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"><ArrowLeft size={18} /></Link>
          <h1 className="text-xl font-bold text-gray-900">Sales History</h1>
        </div>
        {isOwner && (
          <Link href="/pos/sales/import" className="btn-secondary text-xs py-1.5"><UploadCloud size={13} /> Import Historical Sales</Link>
        )}
      </div>

      <div className="card space-y-3">
        <div className="flex items-center bg-gray-100 rounded-lg p-1 gap-0.5 max-w-full overflow-x-auto sm:w-fit sm:flex-wrap">
          <button onClick={() => setPreset(null)}
            className={`shrink-0 whitespace-nowrap px-3 py-2 sm:py-1.5 rounded-md text-xs font-semibold transition-all ${!preset ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            All Dates
          </button>
          {DATE_PRESETS.map(p => (
            <button key={p} onClick={() => setPreset(p)}
              className={`shrink-0 px-3 py-2 sm:py-1.5 rounded-md text-xs font-semibold transition-all whitespace-nowrap ${preset === p ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {p}
            </button>
          ))}
        </div>

        {preset === 'Custom' && (
          <div className="flex items-center gap-3 flex-wrap">
            <input type="date" className="form-input py-1.5 text-sm w-auto" value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
            <span className="text-gray-400 text-sm">—</span>
            <input type="date" className="form-input py-1.5 text-sm w-auto" value={customTo} onChange={e => setCustomTo(e.target.value)} />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <select className="form-input py-1.5 text-sm w-auto" value={businessId} onChange={e => setBusinessId(e.target.value)}>
            <option value="">All Businesses</option>
            {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select className="form-input py-1.5 text-sm w-auto" value={status} onChange={e => setStatus(e.target.value)}>
            <option value="">All Status</option>
            <option value="Completed">Completed</option>
            <option value="Voided">Voided</option>
          </select>
          <select className="form-input py-1.5 text-sm w-auto" value={fulfillmentFilter} onChange={e => setFulfillmentFilter(e.target.value)}>
            <option value="">All Fulfillment</option>
            <option value="FOR_PICKUP">For Pickup</option>
            <option value="RELEASED">Released</option>
          </select>
          <div className="relative w-full sm:w-auto">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-300" />
            <input className="form-input py-2 sm:py-1.5 text-sm pl-8 w-full sm:w-56" placeholder="Search receipt #, customer, mobile"
              value={q} onChange={e => setQ(e.target.value)} />
          </div>
        </div>
      </div>

      {fulfillmentFilter === 'FOR_PICKUP' && !loading && (
        <div className="card border-2 border-blue-200 bg-blue-50 flex items-center gap-2.5">
          <PackageCheck className="text-blue-600 shrink-0" size={18} />
          <p className="text-sm text-blue-800">
            <strong>{sales.length} order{sales.length === 1 ? '' : 's'}</strong> for pickup — <strong>{formatCurrency(sales.reduce((s, sale) => s + sale.total, 0))}</strong> total transaction value
          </p>
        </div>
      )}

      <div className="card">
        {loading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : sales.length === 0 ? (
          <p className="text-center text-gray-400 text-sm py-12">No sales match these filters.</p>
        ) : (
          <>
            <div className="overflow-x-auto hidden md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  {(fulfillmentFilter === 'FOR_PICKUP'
                    ? ['Sale #', 'Date', 'Customer', 'Mobile', 'Total', 'Payment Status', 'Fulfillment', 'Status', 'Actions']
                    : ['Sale #', 'Date', 'Business', 'Cashier', 'Total', 'Cash Applied', 'Online / Card', 'Financing', 'Service/Fee', 'Status', 'Actions']
                  ).map(h => (
                    <th key={h} className="table-header whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sales.map((s, i) => (
                  <tr key={s.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="table-cell font-medium tabular-nums">{displayReceiptNo(s)}</td>
                    <td className="table-cell text-gray-500 whitespace-nowrap">{formatDate(s.created_at)}</td>
                    {fulfillmentFilter === 'FOR_PICKUP' ? (
                      <>
                        <td className="table-cell">{s.customer_name || '—'}</td>
                        <td className="table-cell">{s.customer_mobile || '—'}</td>
                        <td className="table-cell font-semibold whitespace-nowrap tabular-nums">{formatCurrency(s.total)}</td>
                        <td className="table-cell whitespace-nowrap">{derivePaymentStatus(s)}</td>
                        <td className="table-cell">
                          <span className={s.fulfillment_status === 'FOR_PICKUP' ? 'badge-amber' : 'badge-green'}>
                            {s.fulfillment_status === 'FOR_PICKUP' ? 'For Pickup' : 'Released'}
                          </span>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="table-cell">{s.business_name || '—'}</td>
                        <td className="table-cell">{s.cashier_name || '—'}</td>
                        <td className="table-cell font-semibold whitespace-nowrap tabular-nums">{formatCurrency(s.total)}</td>
                        <td className="table-cell text-gray-600 tabular-nums">{cashApplied(s) > 0 ? formatCurrency(cashApplied(s)) : '—'}</td>
                        <td className="table-cell text-gray-600 tabular-nums">{onlineApplied(s) > 0 ? formatCurrency(onlineApplied(s)) : '—'}</td>
                        <td className="table-cell text-gray-600 tabular-nums whitespace-nowrap">
                          {s.financing_provider ? `${s.financing_provider} ${formatCurrency(s.financing_amount)}` : '—'}
                        </td>
                        <td className="table-cell whitespace-nowrap">
                          {s.service_items ? (
                            <span className="text-[11px] font-semibold bg-orange-50 text-orange-700 px-1.5 py-0.5 rounded" title={s.service_items}>
                              {s.service_items}
                            </span>
                          ) : '—'}
                        </td>
                      </>
                    )}
                    <td className="table-cell">
                      <span className={s.status === 'Voided' ? 'badge-red' : 'badge-green'}>{s.status}</span>
                    </td>
                    <td className="table-cell">{rowActions(s, false)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>

            {/* Phone: the 9-11 column table can't fit, so each sale becomes
                a card showing the fields that matter at a glance. */}
            <div className="md:hidden space-y-2.5">
              {sales.map(s => (
                <div key={s.id} className="rounded-xl border border-gray-200 bg-white p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-gray-900 tabular-nums">{displayReceiptNo(s)}</p>
                      <p className="text-xs text-gray-500">{formatDate(s.created_at)}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-base font-bold text-gray-900 tabular-nums">{formatCurrency(s.total)}</p>
                      <span className={s.status === 'Voided' ? 'badge-red' : 'badge-green'}>{s.status}</span>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600">
                    {s.customer_name && <span className="font-medium text-gray-800">{s.customer_name}{s.customer_mobile ? ` · ${s.customer_mobile}` : ''}</span>}
                    {s.business_name && <span>{s.business_name}</span>}
                    {s.cashier_name && <span>Cashier: {s.cashier_name}</span>}
                    {s.fulfillment_status === 'FOR_PICKUP' && <span className="badge-amber">For Pickup</span>}
                    {s.financing_provider && <span>{s.financing_provider} {formatCurrency(s.financing_amount)}</span>}
                    {cashApplied(s) > 0 && <span>Cash {formatCurrency(cashApplied(s))}</span>}
                    {onlineApplied(s) > 0 && <span>Online/Card {formatCurrency(onlineApplied(s))}</span>}
                    {s.service_items && <span className="text-[11px] font-semibold bg-orange-50 text-orange-700 px-1.5 py-0.5 rounded">{s.service_items}</span>}
                  </div>
                  <div className="mt-2 pt-2 border-t border-gray-100 flex justify-end">{rowActions(s, true)}</div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100 text-xs text-gray-500">
              <span>{sales.length} sale{sales.length === 1 ? '' : 's'}</span>
              <span className="font-semibold text-gray-800">Total (excl. voided): {formatCurrency(totalSales)}</span>
            </div>
          </>
        )}
      </div>

      {viewing && (
        <Modal open onClose={() => setViewing(null)} title={displayReceiptNo(viewing.sale)} size="sm">
          <ReceiptView sale={viewing.sale} items={viewing.items} refunds={viewing.refunds} payments={viewing.payments}>
            <button onClick={() => setViewing(null)} className="btn-secondary">Close</button>
            {viewing.sale.status !== 'Voided' && isOwner && viewing.sale.financing_provider && viewing.sale.financing_approval_status === 'Pending' && (
              <button onClick={approveFinancing} disabled={approvingFinancing} className="btn-secondary disabled:opacity-50">
                {approvingFinancing ? 'Approving...' : 'Approve Financing'}
              </button>
            )}
            {viewing.sale.status !== 'Voided' && viewing.sale.fulfillment_status === 'FOR_PICKUP' && (
              <button onClick={() => { setReleasing(viewing); setViewing(null); }} className="btn-primary">Release Item</button>
            )}
            {viewing.sale.status !== 'Voided' && (
              <>
                <button onClick={() => { setRefunding(viewing); setViewing(null); }} className="btn-secondary">Refund Item(s)</button>
                {isOwner && <button onClick={() => setVoiding(viewing.sale)} className="btn-danger">Void Sale</button>}
              </>
            )}
          </ReceiptView>
        </Modal>
      )}

      {releasing && (
        <Modal open onClose={() => setReleasing(null)} title={`Release Item — ${displayReceiptNo(releasing.sale)}`} size="md">
          <ReleaseItemModal
            sale={releasing.sale} items={releasing.items} refunds={releasing.refunds}
            onCancel={() => setReleasing(null)}
            onReleased={() => { setReleasing(null); setViewing(null); showToast('Item released — stock updated'); fetchSales(); }}
          />
        </Modal>
      )}

      {refunding && (
        <Modal open onClose={() => setRefunding(null)} title={`Refund — ${displayReceiptNo(refunding.sale)}`} size="md">
          <RefundModal
            sale={refunding.sale} items={refunding.items} refunds={refunding.refunds}
            cashierName={cashierName}
            onCancel={() => setRefunding(null)}
            onRefunded={() => { setRefunding(null); setViewing(null); showToast('Refund processed — stock restored'); fetchSales(); }}
          />
        </Modal>
      )}

      {voiding && (
        <Modal open onClose={() => !voidBusy && setVoiding(null)} title="Void Sale?" size="sm">
          <p className="text-sm text-gray-600">
            {voiding.fulfillment_status === 'FOR_PICKUP'
              ? <>This will void {displayReceiptNo(voiding)}. The item was never released, so there&apos;s no stock to restore. This cannot be undone.</>
              : <>This will void {displayReceiptNo(voiding)} and restore {formatCurrency(voiding.total)} worth of stock back to inventory. This cannot be undone.</>}
          </p>
          <div className="flex justify-end gap-3 mt-6">
            <button onClick={() => setVoiding(null)} disabled={voidBusy} className="btn-secondary">Cancel</button>
            <button onClick={confirmVoid} disabled={voidBusy} className="btn-danger">{voidBusy ? 'Voiding...' : 'Void Sale'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
