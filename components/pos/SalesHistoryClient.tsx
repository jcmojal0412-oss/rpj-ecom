'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Eye, Ban, Undo2 } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import Spinner from '@/components/ui/Spinner';
import { Toast, useToast } from '@/components/ui/Toast';
import Modal from '@/components/ui/Modal';
import { DATE_PRESETS, resolvePresetRange, type DatePreset } from '@/components/expenses/dateRanges';
import ReceiptView from './ReceiptView';
import RefundModal from './RefundModal';
import type { Business, Sale, SaleItem, Refund } from './constants';

type SaleDetail = { sale: Sale; items: SaleItem[]; refunds: Refund[] };

export default function SalesHistoryClient() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);

  const [preset, setPreset] = useState<DatePreset | null>(null);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [businessId, setBusinessId] = useState('');
  const [status, setStatus] = useState('');

  const [viewing, setViewing] = useState<SaleDetail | null>(null);
  const [voiding, setVoiding] = useState<Sale | null>(null);
  const [voidBusy, setVoidBusy] = useState(false);
  const [refunding, setRefunding] = useState<SaleDetail | null>(null);
  const { toast, showToast, clearToast } = useToast();

  const range = preset ? resolvePresetRange(preset, customFrom, customTo) : null;

  const fetchSales = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (range) { params.set('from', range.from); params.set('to', range.to); }
    if (businessId) params.set('business_id', businessId);
    if (status) params.set('status', status);
    const data = await fetch(`/api/pos/sales?${params.toString()}`).then(r => r.json());
    setSales(data.rows ?? []);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, customFrom, customTo, businessId, status]);

  useEffect(() => { fetchSales(); }, [fetchSales]);
  useEffect(() => {
    fetch('/api/businesses').then(r => r.json()).then(d => setBusinesses(d.rows ?? []));
  }, []);

  const fetchDetail = (id: number): Promise<SaleDetail> => fetch(`/api/pos/sales/${id}`).then(r => r.json());

  const openSale = async (s: Sale) => setViewing(await fetchDetail(s.id));
  const openRefund = async (s: Sale) => setRefunding(await fetchDetail(s.id));

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

  return (
    <div className="p-6 space-y-4">
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}

      <div className="flex items-center gap-3">
        <Link href="/pos" className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"><ArrowLeft size={18} /></Link>
        <h1 className="text-xl font-bold text-gray-900">Sales History</h1>
      </div>

      <div className="card space-y-3">
        <div className="flex items-center bg-gray-100 rounded-lg p-1 gap-0.5 w-fit flex-wrap">
          <button onClick={() => setPreset(null)}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${!preset ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            All Dates
          </button>
          {DATE_PRESETS.map(p => (
            <button key={p} onClick={() => setPreset(p)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all whitespace-nowrap ${preset === p ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
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
        </div>
      </div>

      <div className="card">
        {loading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : sales.length === 0 ? (
          <p className="text-center text-gray-400 text-sm py-12">No sales match these filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  {['Sale #', 'Date', 'Business', 'Cashier', 'Total', 'Cash', 'Online', 'Status', 'Actions'].map(h => (
                    <th key={h} className="table-header">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sales.map((s, i) => (
                  <tr key={s.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="table-cell font-medium tabular-nums">#{String(s.id).padStart(6, '0')}</td>
                    <td className="table-cell text-gray-500 whitespace-nowrap">{formatDate(s.created_at)}</td>
                    <td className="table-cell">{s.business_name || '—'}</td>
                    <td className="table-cell">{s.cashier_name || '—'}</td>
                    <td className="table-cell font-semibold whitespace-nowrap tabular-nums">{formatCurrency(s.total)}</td>
                    <td className="table-cell text-gray-600 tabular-nums">{s.cash_amount > 0 ? formatCurrency(s.cash_amount) : '—'}</td>
                    <td className="table-cell text-gray-600 tabular-nums">{s.online_amount > 0 ? formatCurrency(s.online_amount) : '—'}</td>
                    <td className="table-cell">
                      <span className={s.status === 'Voided' ? 'badge-red' : 'badge-green'}>{s.status}</span>
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center gap-1">
                        <button onClick={() => openSale(s)} className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-600" title="View Receipt"><Eye size={14} /></button>
                        {s.status !== 'Voided' && (
                          <>
                            <button onClick={() => openRefund(s)} className="p-1.5 rounded-lg hover:bg-amber-50 text-gray-300 hover:text-amber-600" title="Refund Item(s)"><Undo2 size={14} /></button>
                            <button onClick={() => setVoiding(s)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-500" title="Void Sale"><Ban size={14} /></button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100 text-xs text-gray-500">
              <span>{sales.length} sale{sales.length === 1 ? '' : 's'}</span>
              <span className="font-semibold text-gray-800">Total (excl. voided): {formatCurrency(totalSales)}</span>
            </div>
          </div>
        )}
      </div>

      {viewing && (
        <Modal open onClose={() => setViewing(null)} title={`Sale #${String(viewing.sale.id).padStart(6, '0')}`} size="sm">
          <ReceiptView sale={viewing.sale} items={viewing.items} refunds={viewing.refunds}>
            <button onClick={() => setViewing(null)} className="btn-secondary">Close</button>
            {viewing.sale.status !== 'Voided' && (
              <>
                <button onClick={() => setRefunding(viewing)} className="btn-secondary">Refund Item(s)</button>
                <button onClick={() => setVoiding(viewing.sale)} className="btn-danger">Void Sale</button>
              </>
            )}
          </ReceiptView>
        </Modal>
      )}

      {refunding && (
        <Modal open onClose={() => setRefunding(null)} title={`Refund — Sale #${String(refunding.sale.id).padStart(6, '0')}`} size="md">
          <RefundModal
            sale={refunding.sale} items={refunding.items} refunds={refunding.refunds}
            onCancel={() => setRefunding(null)}
            onRefunded={() => { setRefunding(null); setViewing(null); showToast('Refund processed — stock restored'); fetchSales(); }}
          />
        </Modal>
      )}

      {voiding && (
        <Modal open onClose={() => !voidBusy && setVoiding(null)} title="Void Sale?" size="sm">
          <p className="text-sm text-gray-600">
            This will void sale #{String(voiding.id).padStart(6, '0')} and restore {formatCurrency(voiding.total)} worth of stock back to inventory. This cannot be undone.
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
