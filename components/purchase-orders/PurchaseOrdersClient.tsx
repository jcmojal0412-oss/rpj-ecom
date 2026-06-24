'use client';

import { useEffect, useState, useCallback } from 'react';
import { Plus, Eye, CheckCircle, XCircle } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Toast, useToast } from '@/components/ui/Toast';
import Modal from '@/components/ui/Modal';
import CreatePOForm from './CreatePOForm';
import PODetail from './PODetail';
import Spinner from '@/components/ui/Spinner';

interface PurchaseOrder {
  id: number; po_number: string; supplier: string;
  total_amount: number; status: 'pending' | 'received' | 'cancelled';
  ordered_at: string; received_at: string | null;
  item_count: number; notes: string;
}

export default function PurchaseOrdersClient() {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [viewingId, setViewingId] = useState<number | null>(null);
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
        <button onClick={() => setShowCreate(true)} className="btn-primary">
          <Plus size={16} /> New PO
        </button>
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
                  {['PO #','Supplier','Items','Total Amount','Status','Ordered Date','Actions'].map(h => (
                    <th key={h} className="table-header">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orders.map((po, i) => (
                  <tr key={po.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="table-cell font-mono text-xs font-semibold text-blue-700">{po.po_number}</td>
                    <td className="table-cell font-medium">{po.supplier}</td>
                    <td className="table-cell text-center">{po.item_count}</td>
                    <td className="table-cell font-semibold">{formatCurrency(po.total_amount)}</td>
                    <td className="table-cell">{statusBadge(po.status)}</td>
                    <td className="table-cell text-gray-500">{po.ordered_at ? formatDate(po.ordered_at) : '—'}</td>
                    <td className="table-cell">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setViewingId(po.id)}
                          className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-600 transition-colors"
                          title="View"
                        >
                          <Eye size={15} />
                        </button>
                        {po.status === 'pending' && (
                          <>
                            <button
                              onClick={() => updateStatus(po.id, 'received')}
                              className="p-1.5 rounded-lg hover:bg-green-50 text-green-600 transition-colors"
                              title="Mark Received"
                            >
                              <CheckCircle size={15} />
                            </button>
                            <button
                              onClick={() => updateStatus(po.id, 'cancelled')}
                              className="p-1.5 rounded-lg hover:bg-red-50 text-red-600 transition-colors"
                              title="Cancel"
                            >
                              <XCircle size={15} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
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
    </div>
  );
}
