'use client';

import { useEffect, useState, useCallback } from 'react';
import { Plus, Eye, CheckCircle, XCircle, CreditCard, Printer, Camera } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Toast, useToast } from '@/components/ui/Toast';
import Modal from '@/components/ui/Modal';
import CreatePOForm from './CreatePOForm';
import PODetail from './PODetail';
import PaymentForm from './PaymentForm';
import BulkScanModal from './BulkScanModal';
import Spinner from '@/components/ui/Spinner';

interface PurchaseOrder {
  id: number; po_number: string; supplier: string;
  total_amount: number; status: 'pending' | 'received' | 'cancelled';
  ordered_at: string; received_at: string | null;
  item_count: number; notes: string;
  paid_amount: number; receipt_path: string | null;
}

export default function PurchaseOrdersClient() {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [viewingId, setViewingId] = useState<number | null>(null);
  const [payingPO, setPayingPO] = useState<PurchaseOrder | null>(null);
  const [showBulkScan, setShowBulkScan] = useState(false);
  const { toast, showToast, clearToast } = useToast();

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    const data = await fetch('/api/purchase-orders').then(r => r.json());
    setOrders(data);
    setLoading(false);
  }, []);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const updateStatus = async (id: number, status: string) => {
    await fetch(`/api/purchase-orders/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    showToast(`PO marked as ${status}`);
    fetchOrders();
  };

  const PO_HEADERS = ['PO #', 'Supplier', 'Items', 'Amount / Payment', 'Status', 'Ordered Date', 'Actions'];

  const statusBadge = (s: string) => {
    if (s === 'received') return <span className="badge-green">Received</span>;
    if (s === 'cancelled') return <span className="badge-gray">Cancelled</span>;
    return <span className="badge-amber">Pending</span>;
  };

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Purchase Orders</h1>
          <p className="text-sm text-gray-500 mt-1">Track and manage supplier orders</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowBulkScan(true)} className="flex items-center gap-2 px-4 py-2 rounded-xl border border-orange-300 text-orange-600 bg-orange-50 hover:bg-orange-100 text-sm font-semibold transition-colors">
            <Camera size={16} /> Scan Receipts
          </button>
          <button onClick={() => setShowCreate(true)} className="btn-primary">
            <Plus size={16} /> New PO
          </button>
        </div>
      </div>

      <div className="card">
        {loading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : orders.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-400 text-sm">No purchase orders yet.</p>
            <button onClick={() => setShowCreate(true)} className="btn-primary mt-4">
              <Plus size={16} /> Create First PO
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  {PO_HEADERS.map(h => (
                    <th key={h} className="table-header">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orders.map((po, i) => {
                  const paid = po.paid_amount ?? 0;
                  const outstanding = po.total_amount - paid;
                  const payStatus = paid >= po.total_amount ? 'Paid' : paid > 0 ? 'Partial' : 'Unpaid';
                  return (
                  <tr key={po.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="table-cell font-mono text-xs font-semibold text-blue-700">{po.po_number}</td>
                    <td className="table-cell font-medium">{po.supplier}</td>
                    <td className="table-cell text-center">{po.item_count}</td>
                    <td className="table-cell">
                      <div>
                        <p className="font-semibold">{formatCurrency(po.total_amount)}</p>
                        <p className={`text-xs font-medium ${payStatus === 'Paid' ? 'text-green-600' : payStatus === 'Partial' ? 'text-amber-600' : 'text-red-500'}`}>
                          {payStatus === 'Paid' ? '✓ Fully Paid'
                            : payStatus === 'Partial' ? `Paid ${formatCurrency(paid)}`
                            : 'Unpaid'}
                        </p>
                      </div>
                    </td>
                    <td className="table-cell">{statusBadge(po.status)}</td>
                    <td className="table-cell text-gray-500">{po.ordered_at ? formatDate(po.ordered_at) : '—'}</td>
                    <td className="table-cell">
                      <div className="flex items-center gap-1">
                        <button onClick={() => setViewingId(po.id)}
                          className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-600 transition-colors" title="View">
                          <Eye size={15} />
                        </button>
                        <button
                          onClick={() => window.open(`/purchase-orders/${po.id}/print`, '_blank')}
                          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-800 transition-colors"
                          title="Print PO"
                        >
                          <Printer size={15} />
                        </button>
                        <button onClick={() => setPayingPO(po)}
                          className="p-1.5 rounded-lg hover:bg-green-50 text-green-600 transition-colors" title="Record Payment">
                          <CreditCard size={15} />
                        </button>
                        {po.status === 'pending' && (
                          <>
                            <button onClick={() => updateStatus(po.id, 'received')}
                              className="p-1.5 rounded-lg hover:bg-green-50 text-green-600 transition-colors" title="Mark Received">
                              <CheckCircle size={15} />
                            </button>
                            <button onClick={() => updateStatus(po.id, 'cancelled')}
                              className="p-1.5 rounded-lg hover:bg-red-50 text-red-600 transition-colors" title="Cancel">
                              <XCircle size={15} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create PO Modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Create Purchase Order" size="xl">
        <CreatePOForm
          onSuccess={() => { setShowCreate(false); showToast('Purchase order created!'); fetchOrders(); }}
          onCancel={() => setShowCreate(false)}
        />
      </Modal>

      {/* PO Detail Modal */}
      {viewingId && (
        <Modal open={!!viewingId} onClose={() => setViewingId(null)} title="Purchase Order Detail" size="lg">
          <PODetail id={viewingId} />
        </Modal>
      )}

      {/* Payment Modal */}
      {payingPO && (
        <Modal open={!!payingPO} onClose={() => setPayingPO(null)} title={`Record Payment — ${payingPO.po_number}`} size="md">
          <PaymentForm
            poId={payingPO.id}
            poNumber={payingPO.po_number}
            totalAmount={payingPO.total_amount}
            currentPaid={payingPO.paid_amount ?? 0}
            currentReceiptPath={payingPO.receipt_path}
            onSuccess={() => { setPayingPO(null); showToast('Payment recorded!'); fetchOrders(); }}
            onCancel={() => setPayingPO(null)}
          />
        </Modal>
      )}

      {/* Bulk Scan Modal */}
      <Modal open={showBulkScan} onClose={() => setShowBulkScan(false)} title="Scan Payment Receipts" size="lg">
        <BulkScanModal
          pos={orders.map(o => ({ id: o.id, po_number: o.po_number, supplier: o.supplier, total_amount: o.total_amount, paid_amount: o.paid_amount ?? 0 }))}
          onClose={() => setShowBulkScan(false)}
          onAllSaved={() => { setShowBulkScan(false); showToast('Payments recorded!'); fetchOrders(); }}
        />
      </Modal>
    </div>
  );
}
