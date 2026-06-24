'use client';

import { useEffect, useState } from 'react';
import { formatCurrency, formatDate } from '@/lib/utils';
import Spinner from '@/components/ui/Spinner';

interface POItem { id: number; sku: string; name: string; quantity: number; unit_cost: number; }
interface PO {
  id: number; po_number: string; supplier: string; total_amount: number;
  status: string; ordered_at: string; received_at: string | null; notes: string;
  items: POItem[];
}

export default function PODetail({ id }: { id: number }) {
  const [po, setPo] = useState<PO | null>(null);

  useEffect(() => {
    fetch(`/api/purchase-orders/${id}`).then(r => r.json()).then(setPo);
  }, [id]);

  if (!po) return <div className="flex justify-center py-8"><Spinner /></div>;

  const statusColor = po.status === 'received' ? 'badge-green' : po.status === 'cancelled' ? 'badge-gray' : 'badge-amber';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
        <div><span className="text-gray-500">PO Number:</span> <span className="font-semibold font-mono ml-2">{po.po_number}</span></div>
        <div><span className="text-gray-500">Supplier:</span> <span className="font-medium ml-2">{po.supplier}</span></div>
        <div><span className="text-gray-500">Status:</span> <span className={`ml-2 ${statusColor}`}>{po.status}</span></div>
        <div><span className="text-gray-500">Ordered:</span> <span className="ml-2">{po.ordered_at ? formatDate(po.ordered_at) : '—'}</span></div>
        {po.received_at && <div><span className="text-gray-500">Received:</span> <span className="ml-2">{formatDate(po.received_at)}</span></div>}
        {po.notes && <div className="col-span-2"><span className="text-gray-500">Notes:</span> <span className="ml-2">{po.notes}</span></div>}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Items</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="table-header">SKU</th>
              <th className="table-header">Product</th>
              <th className="table-header text-right">Qty</th>
              <th className="table-header text-right">Unit Cost</th>
              <th className="table-header text-right">Line Total</th>
            </tr>
          </thead>
          <tbody>
            {po.items.map((item, i) => (
              <tr key={item.id} className={i % 2 === 0 ? '' : 'bg-gray-50'}>
                <td className="table-cell font-mono text-xs text-gray-500">{item.sku}</td>
                <td className="table-cell">{item.name}</td>
                <td className="table-cell text-right">{item.quantity}</td>
                <td className="table-cell text-right">{formatCurrency(item.unit_cost)}</td>
                <td className="table-cell text-right font-medium">{formatCurrency(item.quantity * item.unit_cost)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-200 font-semibold">
              <td className="table-cell" colSpan={4}>Total</td>
              <td className="table-cell text-right text-green-700">{formatCurrency(po.total_amount)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
