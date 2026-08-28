'use client';

import { formatCurrency, formatDate } from '@/lib/utils';
import type { Sale, SaleItem, Refund } from './constants';

interface Props {
  sale: Sale;
  items: SaleItem[];
  refunds?: Refund[];
  children?: React.ReactNode;
}

export default function ReceiptView({ sale, items, refunds, children }: Props) {
  const totalRefunded = (refunds ?? []).reduce((s, r) => s + r.total_refund, 0);
  return (
    <div className="max-w-sm mx-auto">
      <div id="pos-receipt" className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div className="text-center">
          <p className="font-bold text-gray-900">{sale.business_name || 'RPJ ECOM'}</p>
          <p className="text-xs text-gray-400 mt-0.5">Sale #{String(sale.id).padStart(6, '0')}</p>
          <p className="text-xs text-gray-400">{formatDate(sale.created_at)}</p>
          <p className="text-xs text-gray-400">Cashier: {sale.cashier_name || '—'}</p>
          {sale.status === 'Voided' && (
            <span className="inline-block mt-2 text-[11px] font-bold uppercase tracking-wide bg-red-100 text-red-700 px-2 py-0.5 rounded-full">Voided</span>
          )}
          {totalRefunded > 0 && (
            <span className="inline-block mt-2 ml-1 text-[11px] font-bold uppercase tracking-wide bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Partially Refunded</span>
          )}
        </div>

        <div className="border-t border-dashed border-gray-200 pt-3 space-y-1.5">
          {items.map(it => (
            <div key={it.id} className="flex justify-between text-sm">
              <span className="text-gray-700">{it.product_name} <span className="text-gray-400">x{it.quantity}</span></span>
              <span className="font-medium text-gray-900 tabular-nums">{formatCurrency(it.line_total)}</span>
            </div>
          ))}
        </div>

        <div className="border-t border-dashed border-gray-200 pt-3 space-y-1 text-sm">
          <div className="flex justify-between text-gray-500"><span>Subtotal</span><span className="tabular-nums">{formatCurrency(sale.subtotal)}</span></div>
          {sale.discount > 0 && <div className="flex justify-between text-gray-500"><span>Discount</span><span className="tabular-nums">-{formatCurrency(sale.discount)}</span></div>}
          {sale.additional_fee > 0 && <div className="flex justify-between text-gray-500"><span>Additional Fee</span><span className="tabular-nums">{formatCurrency(sale.additional_fee)}</span></div>}
          {sale.tax_amount > 0 && <div className="flex justify-between text-gray-500"><span>Tax ({sale.tax_percent}%)</span><span className="tabular-nums">{formatCurrency(sale.tax_amount)}</span></div>}
          {sale.service_charge > 0 && <div className="flex justify-between text-gray-500"><span>Service Charge</span><span className="tabular-nums">{formatCurrency(sale.service_charge)}</span></div>}
          {sale.delivery_fee > 0 && <div className="flex justify-between text-gray-500"><span>Delivery Fee</span><span className="tabular-nums">{formatCurrency(sale.delivery_fee)}</span></div>}
          <div className="flex justify-between text-base font-bold text-gray-900 pt-1"><span>Total</span><span className="tabular-nums">{formatCurrency(sale.total)}</span></div>
        </div>

        <div className="border-t border-dashed border-gray-200 pt-3 space-y-1 text-sm">
          {sale.payment_method && (
            <div className="flex justify-between text-gray-500"><span>{sale.financing_provider ? 'DP Method' : 'Payment Method'}</span><span>{sale.payment_method}</span></div>
          )}
          {sale.cash_amount > 0 && <div className="flex justify-between text-gray-500"><span>Cash</span><span className="tabular-nums">{formatCurrency(sale.cash_amount)}</span></div>}
          {sale.online_amount > 0 && <div className="flex justify-between text-gray-500"><span>Online</span><span className="tabular-nums">{formatCurrency(sale.online_amount)}</span></div>}
          {!sale.financing_provider && <div className="flex justify-between font-semibold text-gray-900"><span>Change</span><span className="tabular-nums">{formatCurrency(sale.change_due)}</span></div>}
          {sale.reference_no && <div className="flex justify-between text-gray-500"><span>Reference No.</span><span>{sale.reference_no}</span></div>}
        </div>

        {sale.financing_provider && (
          <div className="border-t border-dashed border-gray-200 pt-3 space-y-1 text-sm">
            <p className="text-xs font-semibold text-gray-500 mb-1">Financing</p>
            <div className="flex justify-between text-gray-500"><span>Provider</span><span className="font-medium text-gray-800">{sale.financing_provider}</span></div>
            <div className="flex justify-between font-semibold text-gray-900"><span>Financed Amount</span><span className="tabular-nums">{formatCurrency(sale.financing_amount)}</span></div>
            {sale.financing_reference && <div className="flex justify-between text-gray-500"><span>Reference No.</span><span>{sale.financing_reference}</span></div>}
            <div className="flex justify-between text-gray-500"><span>Status</span><span>{sale.financing_status}</span></div>
          </div>
        )}

        {totalRefunded > 0 && (
          <div className="border-t border-dashed border-gray-200 pt-3 space-y-1 text-sm">
            <div className="flex justify-between text-amber-700 font-semibold"><span>Refunded</span><span className="tabular-nums">-{formatCurrency(totalRefunded)}</span></div>
            <div className="flex justify-between text-gray-900 font-bold"><span>Net</span><span className="tabular-nums">{formatCurrency(sale.total - totalRefunded)}</span></div>
          </div>
        )}

        {sale.notes && <p className="text-xs text-gray-400 border-t border-dashed border-gray-200 pt-3">{sale.notes}</p>}
      </div>

      {children && <div className="mt-4 flex justify-center gap-3 print:hidden">{children}</div>}
    </div>
  );
}
